"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_ORG_ID } from "@/lib/config";

interface DenialRow {
  id: string;
  claimId: string;
  claimNumber: string;
  clientId: string;
  clientName: string;
  providerName: string | null;
  dateOfService: string | null;
  cptCode: string;
  totalCharge: number;
  allowedAmount: number;
  adjustmentAmount: number;
  patientResponsibility: number;
  amountPaid: number;
  denialReasonCode: string | null;
  denialReasonDescription: string | null;
}

interface Payload {
  success: boolean;
  error?: string;
  rows?: DenialRow[];
  clinicianOnly?: boolean;
  canManage?: boolean;
  practiceOptions?: Array<{ value: string; label: string }>;
}

function getOrgId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function reasonLabel(row: DenialRow) {
  if (!row.denialReasonCode && !row.denialReasonDescription) return "—";
  if (!row.denialReasonDescription) return row.denialReasonCode ?? "—";
  if (!row.denialReasonCode) return row.denialReasonDescription;
  return `${row.denialReasonCode} · ${row.denialReasonDescription}`;
}

function BillToPatientModal({
  row,
  organizationId,
  onClose,
  onDone,
}: {
  row: DenialRow;
  organizationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/claims/${row.claimId}/bill-to-patient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to move claim");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move claim");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: "100%", maxWidth: 460, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, color: "var(--navy)" }}>Bill to Patient</h3>
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: "var(--text)" }}>
          Move claim <strong>{row.claimNumber || row.claimId}</strong> for <strong>{row.clientName}</strong> to Patient Balances?
        </p>
        {error ? <p style={{ marginTop: 0, color: "#991b1b", fontSize: 12 }}>{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button" type="button" onClick={confirm} disabled={busy}>{busy ? "Moving..." : "Bill to Patient"}</button>
        </div>
      </div>
    </div>
  );
}

export default function DenialsClient() {
  const router = useRouter();
  const organizationId = useMemo(() => getOrgId(), []);

  const [rows, setRows] = useState<DenialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [practice, setPractice] = useState("");
  const [practiceOptions, setPracticeOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [clinicianOnly, setClinicianOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [billModal, setBillModal] = useState<DenialRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organizationId });
      if (practice) params.set("practice", practice);
      const res = await fetch(`/api/billing/denied-claims?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load denied claims");
      setRows(json.rows ?? []);
      setPracticeOptions(json.practiceOptions ?? []);
      setClinicianOnly(Boolean(json.clinicianOnly));
      setSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load denied claims");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, practice]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      return (
        row.clientName.toLowerCase().includes(query)
        || row.claimNumber.toLowerCase().includes(query)
        || (row.providerName ?? "").toLowerCase().includes(query)
        || (row.cptCode ?? "").toLowerCase().includes(query)
        || reasonLabel(row).toLowerCase().includes(query)
      );
    });
  }, [rows, search]);

  const selectedCount = useMemo(() => filtered.filter((row) => selected[row.id]).length, [filtered, selected]);
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        acc.charge += row.totalCharge;
        acc.allowed += row.allowedAmount;
        acc.patient += row.patientResponsibility;
        return acc;
      },
      { charge: 0, allowed: 0, patient: 0 },
    );
  }, [filtered]);

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {};
    if (value) {
      for (const row of filtered) next[row.id] = true;
    }
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="page-shell" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="hero-card" style={{ padding: 16 }}>
        <h1 style={{ marginTop: 0, marginBottom: 6 }}>Denials Work Queue</h1>
        <p className="hero-copy" style={{ marginBottom: 0 }}>
          Only claims that are currently denied appear here.
        </p>
        {clinicianOnly ? (
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "#475569" }}>
            Clinician scope active: you can only see denied claims tied to your assigned practice/provider scope.
          </p>
        ) : null}
      </section>

      <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Denied Claims</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{filtered.length}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Charge Amount</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(totals.charge)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Patient Responsibility</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(totals.patient)}</div>
        </div>
      </section>

      <section className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input
          className="input"
          style={{ minWidth: 260, flex: "1 1 260px" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient, claim, provider, CPT, CARC/RARC"
        />
        <select className="input" style={{ minWidth: 220 }} value={practice} onChange={(e) => setPractice(e.target.value)}>
          <option value="">All practices</option>
          {practiceOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {toast ? (
        <div style={{ padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", borderRadius: 8 }}>
          {toast}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>
          {error}
        </div>
      ) : null}

      <section className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 1500, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "10px 8px", width: 120 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
                  Select All
                </label>
              </th>
              <th style={{ padding: "10px 8px" }}>Patient Name</th>
              <th style={{ padding: "10px 8px" }}>Date of Service</th>
              <th style={{ padding: "10px 8px" }}>Provider Name</th>
              <th style={{ padding: "10px 8px" }}>CPT/HCPCS</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Charge Amount</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Allowed Amount</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Adjustment Amount</th>
              <th style={{ padding: "10px 8px" }}>CARC/RARC</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Patient Responsibility</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Amount Paid</th>
              <th style={{ padding: "10px 8px" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ padding: 16, color: "#475569" }}>No denied claims found for this scope.</td>
              </tr>
            ) : null}
            {filtered.map((row, index) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                <td style={{ padding: "10px 8px" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={Boolean(selected[row.id])} onChange={() => toggleOne(row.id)} />
                    Line {index + 1}
                  </label>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ fontWeight: 600 }}>{row.clientName}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{row.claimNumber || row.claimId}</div>
                </td>
                <td style={{ padding: "10px 8px" }}>{formatDate(row.dateOfService)}</td>
                <td style={{ padding: "10px 8px" }}>{row.providerName ?? "—"}</td>
                <td style={{ padding: "10px 8px" }}>{row.cptCode || "—"}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatMoney(row.totalCharge)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatMoney(row.allowedAmount)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatMoney(row.adjustmentAmount)}</td>
                <td style={{ padding: "10px 8px" }}>{reasonLabel(row)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatMoney(row.patientResponsibility)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatMoney(row.amountPaid)}</td>
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="button button-secondary" type="button" onClick={() => router.push(`/billing/claims/${row.claimId}/correct`)}>Correct</button>
                    <button className="button button-secondary" type="button" onClick={() => router.push(`/billing/appeals?claimId=${encodeURIComponent(row.claimId)}`)}>Appeal</button>
                    <button className="button" type="button" onClick={() => setBillModal(row)}>Bill to Patient</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {billModal ? (
        <BillToPatientModal
          row={billModal}
          organizationId={organizationId}
          onClose={() => setBillModal(null)}
          onDone={() => {
            setBillModal(null);
            setToast("Claim moved to Patient Balances.");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}