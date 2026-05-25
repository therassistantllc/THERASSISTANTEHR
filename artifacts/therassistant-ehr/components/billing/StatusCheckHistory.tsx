"use client";

import { useEffect, useState } from "react";
import PayerStatusResponseModal from "./PayerStatusResponseModal";

type Inquiry = {
  id: string | null;
  status: string | null;
  status_code: string | null;
  status_text: string | null;
  requested_at: string | null;
  received_at: string | null;
  created_at: string | null;
  triggered_by_display_name: string | null;
};

type EdiTx = {
  id: string | null;
  transaction_type: string | null;
  direction: string | null;
  status: string | null;
  control_number: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

/**
 * StatusCheckHistory
 *
 * Lists every 276/277 claim status inquiry for a single claim, newest first.
 * Each row opens the same `PayerStatusResponseModal` already used by the
 * No-Response workqueue and the claim detail page. Originally lived inline
 * inside `NoResponseClient`; extracted so the claim detail page can render
 * the identical UI.
 */
export default function StatusCheckHistory({
  claimId,
  organizationId,
  bumpKey = 0,
}: {
  claimId: string;
  organizationId: string;
  bumpKey?: number;
}) {
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [transactions, setTransactions] = useState<EdiTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openInquiryId, setOpenInquiryId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInquiries(null);
    setTransactions([]);
    setError(null);
    fetch(
      `/api/billing/claims/${claimId}/status-inquiries?organizationId=${encodeURIComponent(organizationId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success === false) {
          setError(j.error || "Failed to load status check history");
          setInquiries([]);
          return;
        }
        setInquiries((j?.inquiries ?? []) as Inquiry[]);
        setTransactions((j?.transactions ?? []) as EdiTx[]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [claimId, organizationId, bumpKey]);

  if (error)
    return <div style={{ color: "#B91C1C", fontSize: 13 }}>{error}</div>;
  if (inquiries == null)
    return <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</div>;
  if (inquiries.length === 0 && transactions.length === 0)
    return (
      <div style={{ color: "#94A3B8", fontSize: 13 }}>
        No claim status inquiries have been run for this claim yet. Use
        “Run claim status” to check with the payer.
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {inquiries.map((i, idx) => {
        const when = i.received_at ?? i.requested_at ?? i.created_at;
        const headline = i.status ?? "unknown";
        const code = i.status_code ? ` · ${i.status_code}` : "";
        const canOpen = Boolean(i.id);
        return (
          <button
            key={i.id ?? `inq-${idx}`}
            type="button"
            disabled={!canOpen}
            onClick={() => {
              if (i.id) setOpenInquiryId(i.id);
            }}
            title={canOpen ? "View full payer response" : undefined}
            style={{
              textAlign: "left",
              border: "1px solid #E5E7EB",
              borderRadius: 6,
              padding: 10,
              background: "#F9FAFB",
              cursor: canOpen ? "pointer" : "default",
              font: "inherit",
              color: "inherit",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
                color: "#6B7280",
                marginBottom: 4,
              }}
            >
              <span>
                {formatDateTime(when)}
                {i.triggered_by_display_name
                  ? ` · ${i.triggered_by_display_name}`
                  : ""}
              </span>
              {canOpen ? (
                <span style={{ color: "#1D4ED8", fontWeight: 600 }}>
                  View response →
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {headline}
              {code}
            </div>
            {i.status_text ? (
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                {i.status_text}
              </div>
            ) : null}
          </button>
        );
      })}
      {openInquiryId ? (
        <PayerStatusResponseModal
          claimId={claimId}
          inquiryId={openInquiryId}
          organizationId={organizationId}
          onClose={() => setOpenInquiryId(null)}
        />
      ) : null}
      {transactions.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            276 / 277 transmissions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {transactions.map((t, idx) => (
              <div
                key={t.id ?? `tx-${idx}`}
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: 6,
                  padding: 8,
                  background: "#FFFFFF",
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <div style={{ fontWeight: 600, color: "#0F172A" }}>
                  {t.transaction_type ?? "EDI"}
                  {t.direction ? ` · ${t.direction}` : ""}
                  {t.status ? ` · ${t.status}` : ""}
                </div>
                <div style={{ marginTop: 2 }}>
                  {formatDateTime(t.received_at ?? t.sent_at ?? t.created_at)}
                  {t.control_number ? ` · ctrl ${t.control_number}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
