"use client";

import { useEffect, useState } from "react";
import PayerStatusResponseModal from "./PayerStatusResponseModal";

type InquirySummary = {
  id: string | null;
  status: string | null;
  status_code: string | null;
  status_text: string | null;
  requested_at: string | null;
  received_at: string | null;
  created_at: string | null;
  triggered_by_display_name: string | null;
};

type LineSummary = {
  total_charge_amount: number | null;
  paid_amount: number | null;
  check_eft_number: string | null;
  payer_claim_control_number: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

/**
 * LatestPayerStatusResponse
 *
 * Inline card showing the most recent 276/277 claim status response for a
 * single claim — the headline status, paid/billed, and check/EFT pulled from
 * the first STC line — with a "View full response" button that opens the
 * same modal used by the No-Response workqueue.
 */
export default function LatestPayerStatusResponse({
  claimId,
  organizationId,
}: {
  claimId: string;
  organizationId: string;
}) {
  const [inquiry, setInquiry] = useState<InquirySummary | null>(null);
  const [line, setLine] = useState<LineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId || !organizationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/billing/claims/${claimId}/status-inquiries?organizationId=${encodeURIComponent(organizationId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then(async (j) => {
        if (cancelled) return;
        if (j?.success === false) {
          setError(j.error || "Failed to load payer status");
          setInquiry(null);
          setLine(null);
          setLoading(false);
          return;
        }
        const inquiries = (j?.inquiries ?? []) as InquirySummary[];
        // The list endpoint sorts by created_at desc, so the latest with
        // an id is the freshest inquiry the biller has run.
        const latest = inquiries.find((i) => i.id) ?? null;
        setInquiry(latest);
        if (latest?.id) {
          try {
            const dr = await fetch(
              `/api/billing/claims/${claimId}/status-inquiries/${latest.id}?organizationId=${encodeURIComponent(organizationId)}`,
              { cache: "no-store" },
            );
            const dj = await dr.json();
            if (cancelled) return;
            if (dj?.success !== false) {
              const lines = (dj?.lines ?? []) as LineSummary[];
              setLine(lines[0] ?? null);
            }
          } catch {
            // The headline card still works without parsed line detail;
            // the user can open the modal for the full breakdown.
          }
        } else {
          setLine(null);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [claimId, organizationId]);

  const cardStyle: React.CSSProperties = {
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    padding: 16,
    background: "#fff",
  };

  if (loading) {
    return (
      <section style={cardStyle}>
        <header style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>Latest payer status response</strong>
        </header>
        <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section style={cardStyle}>
        <header style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>Latest payer status response</strong>
        </header>
        <div style={{ color: "#B91C1C", fontSize: 13 }}>{error}</div>
      </section>
    );
  }

  if (!inquiry) {
    return (
      <section style={cardStyle}>
        <header style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>Latest payer status response</strong>
        </header>
        <div style={{ color: "#94A3B8", fontSize: 13 }}>
          No payer status inquiries have been run for this claim yet.
        </div>
      </section>
    );
  }

  const when =
    inquiry.received_at ?? inquiry.requested_at ?? inquiry.created_at;
  const headline = inquiry.status ?? "unknown";
  const code = inquiry.status_code ? ` · ${inquiry.status_code}` : "";

  return (
    <section style={cardStyle}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>Latest payer status response</strong>
        {inquiry.id ? (
          <button
            type="button"
            onClick={() => setOpenId(inquiry.id)}
            style={{
              background: "transparent",
              border: "none",
              color: "#1D4ED8",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              padding: 0,
            }}
          >
            View full response →
          </button>
        ) : null}
      </header>
      <div
        style={{
          fontSize: 12,
          color: "#6B7280",
          marginBottom: 4,
        }}
      >
        {formatDateTime(when)}
        {inquiry.triggered_by_display_name
          ? ` · ${inquiry.triggered_by_display_name}`
          : ""}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>
        {headline}
        {code}
      </div>
      {inquiry.status_text ? (
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
          {inquiry.status_text}
        </div>
      ) : null}
      {line ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 12px",
            marginTop: 10,
            fontSize: 12,
            color: "#475569",
          }}
        >
          {line.total_charge_amount != null ? (
            <>
              <strong>Billed</strong>
              <span>{formatCurrency(line.total_charge_amount)}</span>
            </>
          ) : null}
          {line.paid_amount != null ? (
            <>
              <strong>Paid</strong>
              <span>{formatCurrency(line.paid_amount)}</span>
            </>
          ) : null}
          {line.check_eft_number ? (
            <>
              <strong>Check / EFT</strong>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {line.check_eft_number}
              </span>
            </>
          ) : null}
          {line.payer_claim_control_number ? (
            <>
              <strong>Payer claim #</strong>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {line.payer_claim_control_number}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {openId ? (
        <PayerStatusResponseModal
          claimId={claimId}
          inquiryId={openId}
          organizationId={organizationId}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  );
}
