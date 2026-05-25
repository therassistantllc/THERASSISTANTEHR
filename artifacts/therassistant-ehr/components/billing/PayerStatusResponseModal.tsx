"use client";

import { useEffect, useState } from "react";

type InquiryDetailLine = {
  id: string | null;
  status_category_code: string | null;
  status_code: string | null;
  entity_code: string | null;
  status_effective_date: string | null;
  total_charge_amount: number | null;
  paid_amount: number | null;
  check_eft_number: string | null;
  payer_claim_control_number: string | null;
  service_date_from: string | null;
  service_date_to: string | null;
  message: string | null;
  raw_stc_segment: unknown;
};

type InquiryDetail = {
  id: string | null;
  status: string | null;
  status_code: string | null;
  status_text: string | null;
  requested_at: string | null;
  received_at: string | null;
  created_at: string | null;
  external_transaction_id: string | null;
  payer_id: string | null;
  payer_name: string | null;
  raw_response_json: unknown;
  raw_response_x12: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

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

function DetailKV({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "4px 0",
        fontSize: 13,
        borderBottom: "1px dashed #E5E7EB",
      }}
    >
      <span style={{ color: "#64748B" }}>{label}</span>
      <span
        style={{
          color: "#0F172A",
          textAlign: "right",
          maxWidth: "60%",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * PayerStatusResponseModal
 *
 * Reusable detail modal for a single 276/277 claim status inquiry. Fetches
 * from `/api/billing/claims/[claimId]/status-inquiries/[inquiryId]` and shows
 * the parsed STC lines plus the raw JSON / X12 payloads. Originally lived
 * inside `NoResponseClient` (as `InquiryDetailModal`); extracted so the
 * claim detail page can reuse the same UI.
 */
export default function PayerStatusResponseModal({
  claimId,
  inquiryId,
  organizationId,
  onClose,
}: {
  claimId: string;
  inquiryId: string;
  organizationId: string;
  onClose: () => void;
}) {
  const [inquiry, setInquiry] = useState<InquiryDetail | null>(null);
  const [lines, setLines] = useState<InquiryDetailLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawTab, setRawTab] = useState<"parsed" | "json" | "x12">("parsed");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/billing/claims/${claimId}/status-inquiries/${inquiryId}?organizationId=${encodeURIComponent(organizationId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success === false) {
          setError(j.error || "Failed to load inquiry");
        } else {
          setInquiry(j.inquiry as InquiryDetail);
          setLines((j.lines ?? []) as InquiryDetailLine[]);
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
  }, [claimId, inquiryId, organizationId]);

  const title = inquiry
    ? `Payer status response · ${formatDateTime(
        inquiry.received_at ?? inquiry.requested_at ?? inquiry.created_at,
      )}`
    : "Payer status response";

  const tabBtn = (id: "parsed" | "json" | "x12", label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setRawTab(id)}
      style={{
        border: "none",
        background: "transparent",
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: rawTab === id ? 600 : 500,
        color: rawTab === id ? "#1D4ED8" : "#475569",
        borderBottom:
          rawTab === id ? "2px solid #1D4ED8" : "2px solid transparent",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: 760,
          maxWidth: "92vw",
          maxHeight: "88vh",
          overflow: "auto",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#6B7280",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {loading ? (
          <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ color: "#B91C1C", fontSize: 13 }}>{error}</div>
        ) : inquiry ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <DetailKV label="Status" value={inquiry.status ?? "—"} />
              <DetailKV
                label="Status code"
                value={inquiry.status_code ?? "—"}
              />
              <DetailKV
                label="Payer text"
                value={inquiry.status_text ?? "—"}
              />
              <DetailKV label="Payer" value={inquiry.payer_name ?? "—"} />
              <DetailKV
                label="Transaction ID"
                value={
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {inquiry.external_transaction_id ?? "—"}
                  </span>
                }
              />
              <DetailKV
                label="Requested"
                value={formatDateTime(inquiry.requested_at)}
              />
              <DetailKV
                label="Received"
                value={formatDateTime(inquiry.received_at)}
              />
            </div>
            <div
              role="tablist"
              aria-label="Response view"
              style={{
                display: "flex",
                gap: 4,
                borderBottom: "1px solid #E5E7EB",
              }}
            >
              {tabBtn("parsed", `Parsed lines (${lines.length})`)}
              {tabBtn("json", "Raw JSON")}
              {tabBtn("x12", "Raw X12")}
            </div>
            {rawTab === "parsed" ? (
              lines.length === 0 ? (
                <div style={{ color: "#94A3B8", fontSize: 13 }}>
                  No parsed STC lines returned by the payer.
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {lines.map((l, idx) => (
                    <div
                      key={l.id ?? `ln-${idx}`}
                      style={{
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        padding: 10,
                        background: "#F9FAFB",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#0F172A",
                        }}
                      >
                        {l.status_category_code ?? "—"}
                        {l.status_code ? ` · ${l.status_code}` : ""}
                        {l.entity_code ? ` · entity ${l.entity_code}` : ""}
                      </div>
                      {l.message ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#475569",
                            marginTop: 4,
                          }}
                        >
                          {l.message}
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: "4px 12px",
                          marginTop: 6,
                          fontSize: 12,
                          color: "#475569",
                        }}
                      >
                        {l.total_charge_amount != null ? (
                          <>
                            <strong>Billed</strong>
                            <span>
                              {formatCurrency(l.total_charge_amount)}
                            </span>
                          </>
                        ) : null}
                        {l.paid_amount != null ? (
                          <>
                            <strong>Paid</strong>
                            <span>{formatCurrency(l.paid_amount)}</span>
                          </>
                        ) : null}
                        {l.check_eft_number ? (
                          <>
                            <strong>Check / EFT</strong>
                            <span
                              style={{ fontFamily: "ui-monospace, monospace" }}
                            >
                              {l.check_eft_number}
                            </span>
                          </>
                        ) : null}
                        {l.payer_claim_control_number ? (
                          <>
                            <strong>Payer claim #</strong>
                            <span
                              style={{ fontFamily: "ui-monospace, monospace" }}
                            >
                              {l.payer_claim_control_number}
                            </span>
                          </>
                        ) : null}
                        {l.service_date_from || l.service_date_to ? (
                          <>
                            <strong>Service dates</strong>
                            <span>
                              {formatDate(l.service_date_from)}
                              {l.service_date_to &&
                              l.service_date_to !== l.service_date_from
                                ? ` – ${formatDate(l.service_date_to)}`
                                : ""}
                            </span>
                          </>
                        ) : null}
                        {l.status_effective_date ? (
                          <>
                            <strong>Effective</strong>
                            <span>
                              {formatDate(l.status_effective_date)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : rawTab === "json" ? (
              <pre
                style={{
                  background: "#0F172A",
                  color: "#F1F5F9",
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 12,
                  maxHeight: 420,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {inquiry.raw_response_json
                  ? JSON.stringify(inquiry.raw_response_json, null, 2)
                  : "No raw JSON stored for this inquiry."}
              </pre>
            ) : (
              <pre
                style={{
                  background: "#0F172A",
                  color: "#F1F5F9",
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 12,
                  maxHeight: 420,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {inquiry.raw_response_x12 ??
                  "No raw X12 stored for this inquiry."}
              </pre>
            )}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 16,
          }}
        >
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
