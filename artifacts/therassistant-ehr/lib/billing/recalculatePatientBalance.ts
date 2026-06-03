import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type DbRow = Record<string, unknown>;

function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export async function recalculatePatientBalance(args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, organizationId, clientId } = args;
  const sb = supabase as unknown as { from: (table: string) => any };
  const now = new Date().toISOString();

  const [{ data: ledgerRows, error: ledgerErr }, { data: invoiceRows, error: invoiceErr }] = await Promise.all([
    sb
      .from("client_ledger_entries")
      .select("entry_type, debit_amount, credit_amount, balance_effect, posting_date, created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null),
    sb
      .from("patient_invoices")
      .select("patient_responsibility_amount, paid_amount, balance_amount, invoice_status, created_at, updated_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null),
  ]);

  if (ledgerErr) return { ok: false, error: ledgerErr.message ?? "client_ledger_entries query failed" };
  if (invoiceErr) return { ok: false, error: invoiceErr.message ?? "patient_invoices query failed" };

  const ledgers = ((ledgerRows ?? []) as DbRow[]);
  const invoices = ((invoiceRows ?? []) as DbRow[]).filter((row) => {
    const status = text(row.invoice_status).toLowerCase();
    return status !== "void" && status !== "voided";
  });

  const totalPatientResponsibleFromInvoices = invoices.reduce(
    (sum, row) => sum + money(row.patient_responsibility_amount),
    0,
  );
  const totalPatientPaidFromInvoices = invoices.reduce((sum, row) => sum + money(row.paid_amount), 0);
  const invoiceBalance = invoices.reduce((sum, row) => sum + money(row.balance_amount), 0);

  const insurancePayments = ledgers
    .filter((row) => text(row.entry_type) === "insurance_payment")
    .reduce((sum, row) => sum + money(row.credit_amount), 0);

  const patientPayments = ledgers
    .filter((row) => ["patient_payment", "card_payment", "cash_payment", "check_payment"].includes(text(row.entry_type)))
    .reduce((sum, row) => sum + money(row.credit_amount), 0);

  const adjustments = ledgers
    .filter((row) => text(row.entry_type).includes("adjustment"))
    .reduce((sum, row) => sum + money(row.credit_amount) - money(row.debit_amount), 0);

  const ledgerBalanceEffect = ledgers.reduce((sum, row) => sum + money(row.balance_effect), 0);
  const currentBalance = invoiceBalance || Math.max(0, totalPatientResponsibleFromInvoices + ledgerBalanceEffect);

  const lastPaymentRows = ledgers
    .filter((row) => money(row.credit_amount) > 0 && ["insurance_payment", "patient_payment", "card_payment", "cash_payment", "check_payment"].includes(text(row.entry_type)))
    .sort((a, b) => String(b.posting_date ?? b.created_at ?? "").localeCompare(String(a.posting_date ?? a.created_at ?? "")));
  const lastPayment = lastPaymentRows[0] ?? null;
  const lastPaymentDate = lastPayment ? isoDate(lastPayment.posting_date ?? lastPayment.created_at) : null;
  const lastPaymentAmount = lastPayment ? money(lastPayment.credit_amount) : 0;

  let b0_30 = 0;
  let b31_60 = 0;
  let b61_90 = 0;
  let b91_120 = 0;
  let b120 = 0;

  for (const inv of invoices) {
    const bal = money(inv.balance_amount);
    if (bal <= 0) continue;
    const age = daysBetween(isoDate(inv.created_at ?? inv.updated_at)) ?? 0;
    if (age <= 30) b0_30 += bal;
    else if (age <= 60) b31_60 += bal;
    else if (age <= 90) b61_90 += bal;
    else if (age <= 120) b91_120 += bal;
    else b120 += bal;
  }

  const row = {
    organization_id: organizationId,
    client_id: clientId,
    total_billed: totalPatientResponsibleFromInvoices,
    total_insurance_paid: insurancePayments,
    total_contractual_adj: Math.max(0, adjustments),
    total_patient_responsible: totalPatientResponsibleFromInvoices,
    total_patient_paid: totalPatientPaidFromInvoices || patientPayments,
    current_balance: currentBalance,
    balance_0_30: money(b0_30),
    balance_31_60: money(b31_60),
    balance_61_90: money(b61_90),
    balance_91_120: money(b91_120),
    balance_120_plus: money(b120),
    last_payment_date: lastPaymentDate,
    last_payment_amount: lastPaymentAmount,
    computed_at: now,
    updated_at: now,
  };

  const { error } = await sb
    .from("patient_balances")
    .upsert(row, { onConflict: "organization_id,client_id" });

  if (error) return { ok: false, error: error.message ?? "patient_balances upsert failed" };
  return { ok: true };
}
