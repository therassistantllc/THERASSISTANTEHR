"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type InvoicePayment = {
  id: string;
  payment_status?: string | null;
  payment_method?: string | null;
  amount?: string | number | null;
  paid_at?: string | null;
  memo?: string | null;
};

type Invoice = {
  id: string;
  invoiceNumber?: unknown;
  status?: unknown;
  patientResponsibilityAmount: number;
  paidAmount: number;
  balanceAmount: number;
  source?: unknown;
  createdAt?: unknown;
  payments: InvoicePayment[];
};

type PatientBalancePayload = {
  success: boolean;
  error?: string;
  patient?: { id: string; name: string; dateOfBirth?: string | null; email?: string | null; phone?: string | null };
  totals?: { openBalance: number; totalPaid: number; totalResponsibility: number; invoiceCount: number };
  invoices?: Invoice[];
};

type LedgerEntry = {
  key: string;
  date: string | null;
  kind: "invoice" | "payment";
  description: string;
  reference: string;
  charge: number;
  credit: number;
  status?: string;
  invoiceId: string;
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function formatMoney(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function statusClass(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("posted")) return "status status-green";
  if (normalized.includes("void") || normalized.includes("failed") || normalized.includes("collections")) return "status status-red";
  if (normalized.includes("open") || normalized.includes("sent") || normalized.includes("pending")) return "status status-yellow";
  return "status";
}

function buildLedger(invoices: Invoice[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const inv of invoices) {
    const invDate = inv.createdAt ? String(inv.createdAt) : null;
    const ref = String(inv.invoiceNumber ?? inv.id.slice(0, 8));
    entries.push({
      key: `inv:${inv.id}`,
      date: invDate,
      kind: "invoice",
      description: `Invoice ${ref}`,
      reference: ref,
      charge: Number(inv.patientResponsibilityAmount ?? 0),
      credit: 0,
      status: String(inv.status ?? ""),
      invoiceId: inv.id,
    });
    for (const pay of inv.payments) {
      entries.push({
        key: `pay:${pay.id}`,
        date: pay.paid_at ?? invDate,
        kind: "payment",
        description: `Payment · ${pay.payment_method ?? "method not set"}${pay.memo ? ` — ${pay.memo}` : ""}`,
        reference: ref,
        charge: 0,
        credit: Number(pay.amount ?? 0),
        status: String(pay.payment_status ?? "posted"),
        invoiceId: inv.id,
      });
    }
  }
  entries.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    if (ta !== tb) return ta - tb;
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    return 0;
  });
  return entries;
}

export default function PatientBalanceClient({ clientId }: { clientId: string }) {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [payload, setPayload] = useState<PatientBalancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadBalance() {
    if (!organizationId) {
      setError("Missing organizationId. Add ?organizationId=... to the URL or configure NEXT_PUBLIC_ORGANIZATION_ID.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/patients/${clientId}/balance?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" });
      const json = (await response.json()) as PatientBalancePayload;
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to load patient balance");
      setPayload(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load patient balance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, organizationId]);

  async function postAction(path: string, body: Record<string, unknown>, successMessage: string) {
    setActionMessage(null);
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { success?: boolean; error?: string; result?: { errors?: Array<{ message: string }> } };
    if (!response.ok || !json.success) {
      const detail = json.result?.errors?.[0]?.message ?? json.error ?? "Action failed";
      throw new Error(detail);
    }
    setActionMessage(successMessage);
    await loadBalance();
  }

  async function recordManualPayment(invoice: Invoice) {
    const amount = window.prompt("Payment amount", String(invoice.balanceAmount));
    if (!amount) return;
    try {
      await postAction(
        "/api/patient-invoices/pay",
        { organizationId, patientInvoiceId: invoice.id, amount: Number(amount), paymentMethod: "manual", memo: "Manual payment posted from patient balance screen" },
        "Payment posted.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    }
  }

  async function markSent(invoice: Invoice) {
    try {
      await postAction(
        "/api/patient-invoices/mark-sent",
        { organizationId, patientInvoiceId: invoice.id, memo: "Marked sent from patient balance screen" },
        "Invoice marked sent.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mark sent failed");
    }
  }

  async function voidInvoice(invoice: Invoice) {
    if (!window.confirm("Void this invoice? This removes the collectible balance from this invoice.")) return;
    try {
      await postAction(
        "/api/patient-invoices/void",
        { organizationId, patientInvoiceId: invoice.id, memo: "Voided from patient balance screen" },
        "Invoice voided.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Void failed");
    }
  }

  const patient = payload?.patient;
  const totals = payload?.totals;
  const invoices = payload?.invoices ?? [];
  const ledger = useMemo(() => buildLedger(invoices), [invoices]);

  let running = 0;
  const ledgerWithBalance = ledger.map((entry) => {
    running = running + entry.charge - entry.credit;
    return { ...entry, runningBalance: running };
  });

  if (loading) return <div className="empty-state">Loading balance…</div>;
  if (error) return <div className="alert-panel">{error}</div>;
  if (!patient) return <div className="alert-panel">Patient balance not found.</div>;

  const orgQ = `?organizationId=${encodeURIComponent(organizationId)}`;
  const statementHref = `/clients/${patient.id}/balance/statement/print${orgQ}`;

  return (
    <>
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Patient Balance</p>
          <h1>{patient.name}</h1>
          <p className="hero-copy">Account ledger of charges, payments, and adjustments with running balance.</p>
        </div>
        <div className="hero-actions">
          <a
            className="button button-primary"
            href={statementHref}
            target="_blank"
            rel="noreferrer"
          >
            Generate statement
          </a>
          <Link className="button button-secondary" href={`/billing/payments${orgQ}`}>
            Enter payment
          </Link>
          <Link className="button button-secondary" href={`/clients/${patient.id}${orgQ}`}>Patient Chart</Link>
        </div>
      </section>

      {actionMessage ? <div className="empty-state success-panel">{actionMessage}</div> : null}

      <section className="metric-grid">
        <article className="metric-card">
          <span>Open Balance</span>
          <strong>{formatMoney(totals?.openBalance ?? 0)}</strong>
        </article>
        <article className="metric-card">
          <span>Total Responsibility</span>
          <strong>{formatMoney(totals?.totalResponsibility ?? 0)}</strong>
        </article>
        <article className="metric-card">
          <span>Total Paid</span>
          <strong>{formatMoney(totals?.totalPaid ?? 0)}</strong>
        </article>
        <article className="metric-card">
          <span>Invoices</span>
          <strong>{totals?.invoiceCount ?? 0}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Account ledger</h2>
          <span className="muted" style={{ fontSize: 12 }}>{ledgerWithBalance.length} entries</span>
        </div>
        {ledgerWithBalance.length === 0 ? (
          <div className="empty-state">No ledger activity yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Reference</th>
                <th style={{ textAlign: "right" }}>Charge</th>
                <th style={{ textAlign: "right" }}>Credit</th>
                <th style={{ textAlign: "right" }}>Running balance</th>
              </tr>
            </thead>
            <tbody>
              {ledgerWithBalance.map((entry) => (
                <tr key={entry.key}>
                  <td>{formatDate(entry.date)}</td>
                  <td>
                    <span className={entry.kind === "payment" ? "status status-green" : "status"}>
                      {entry.kind === "payment" ? "Payment" : "Invoice"}
                    </span>
                  </td>
                  <td>{entry.description}</td>
                  <td>
                    <Link className="inline-link" href={`/clients/${patient.id}/balance/invoice/${entry.invoiceId}/print${orgQ}`} target="_blank">
                      {entry.reference}
                    </Link>
                  </td>
                  <td style={{ textAlign: "right" }}>{entry.charge ? formatMoney(entry.charge) : ""}</td>
                  <td style={{ textAlign: "right" }}>{entry.credit ? formatMoney(entry.credit) : ""}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(entry.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
        </div>
        {invoices.length === 0 ? <p className="muted">No patient invoices found.</p> : null}
        <div className="stack-list">
          {invoices.map((invoice) => (
            <article className="stack-item" key={invoice.id}>
              <div className="stack-row">
                <div>
                  <strong>{String(invoice.invoiceNumber ?? "Invoice")}</strong>
                  <span className={statusClass(invoice.status)}>{String(invoice.status ?? "status not set")}</span>
                  <span>Created: {formatDate(invoice.createdAt)}</span>
                </div>
                <div className="invoice-money-grid">
                  <span>Responsibility: {formatMoney(invoice.patientResponsibilityAmount)}</span>
                  <span>Paid: {formatMoney(invoice.paidAmount)}</span>
                  <span>Balance: {formatMoney(invoice.balanceAmount)}</span>
                </div>
              </div>

              <div className="section-actions">
                <a
                  className="button button-primary"
                  href={`/clients/${patient.id}/balance/invoice/${invoice.id}/print${orgQ}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Print invoice
                </a>
                <button className="button button-secondary" type="button" onClick={() => recordManualPayment(invoice)}>Post Payment</button>
                <button className="button button-secondary" type="button" onClick={() => markSent(invoice)}>Mark Sent</button>
                <button className="button button-secondary" type="button" onClick={() => voidInvoice(invoice)}>Void</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
