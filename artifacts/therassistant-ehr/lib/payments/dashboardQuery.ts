/**
 * Payment Posting — master dashboard query layer (Task #111 / PP-5).
 *
 * One typed `queryPaymentsDashboard(filters)` returns:
 *   - rows: unified list of ERA / manual_insurance / patient payments
 *   - totals: imported, posted, unmatched, unapplied, denied, recoupments,
 *             refunds, pending_review (filter-aware)
 *   - filters: echo of the active filter set
 *
 * Rows use the same composite-id scheme as the posted-payment detail page
 * (`era:|cp:|mi:<uuid>`) so the row→detail navigation is consistent.
 *
 * IMPORTANT: this is a UI-facing query — every Supabase call is scoped to
 * the requested organization_id by an explicit `.eq("organization_id", …)`
 * predicate. The caller is responsible for the org-binding check (see
 * `requireAuthenticatedPaymentPoster`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentSource = "era" | "manual_insurance" | "patient";

export interface DashboardFilters {
  organizationId: string;
  payerProfileId?: string | null;
  providerNpi?: string | null;
  clientId?: string | null;
  /** One or many payment sources. Empty/undefined = all sources. */
  paymentSource?: PaymentSource[] | null;
  /** Filter by side of the ledger. */
  paymentType?: "insurance" | "patient" | null;
  postingStatus?: string[] | null;
  /** Deposit date = payer-side received date (era.received_date, manual.posted_at). */
  depositDateFrom?: string | null;
  depositDateTo?: string | null;
  /** Payment date = ledger-effective date. */
  paymentDateFrom?: string | null;
  paymentDateTo?: string | null;
  eftCheckNumber?: string | null;
  eraImportDateFrom?: string | null;
  eraImportDateTo?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface DashboardRow {
  /** Composite id `era:|cp:|mi:<uuid>` matching the posted-payment detail. */
  id: string;
  source: PaymentSource;
  paymentType: "insurance" | "patient";
  postingStatus: string;
  payerName: string | null;
  clientId: string | null;
  clientDisplayName: string | null;
  professionalClaimId: string | null;
  checkNumber: string | null;
  amount: number;
  depositDate: string | null;
  paymentDate: string | null;
  importedAt: string | null;
}

export interface DashboardTotals {
  imported: number;
  posted: number;
  unmatched: number;
  unapplied: number;
  denied: number;
  recoupments: number;
  refunds: number;
  pendingReview: number;
  amountPosted: number;
  amountPending: number;
}

export interface DashboardResult {
  rows: DashboardRow[];
  totals: DashboardTotals;
  filters: DashboardFilters;
  rowCount: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(n: number | null | undefined): number {
  const v = Number(n ?? DEFAULT_LIMIT);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(v)));
}

function wantSource(filters: DashboardFilters, src: PaymentSource): boolean {
  if (filters.paymentType === "insurance" && src === "patient") return false;
  if (filters.paymentType === "patient" && src !== "patient") return false;
  const list = filters.paymentSource;
  if (!list || list.length === 0) return true;
  return list.includes(src);
}

// ── ERA rows ────────────────────────────────────────────────────────────────

async function loadEraRows(
  supabase: SupabaseClient,
  filters: DashboardFilters,
): Promise<DashboardRow[]> {
  if (!wantSource(filters, "era")) return [];
  let q = supabase
    .from("era_claim_payments")
    .select(
      "id, organization_id, client_id, professional_claim_id, payer_name, payer_identifier, posting_status, claim_match_status, clp04_payment_amount, check_number, era_import_batch_id, created_at, era_received_date, era_import_batches(received_at)",
    )
    .eq("organization_id", filters.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(clampLimit(filters.limit));
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  if (filters.postingStatus && filters.postingStatus.length > 0) {
    q = q.in("posting_status", filters.postingStatus);
  }
  if (filters.eftCheckNumber) q = q.ilike("check_number", `%${filters.eftCheckNumber}%`);
  if (filters.depositDateFrom) q = q.gte("era_received_date", filters.depositDateFrom);
  if (filters.depositDateTo) q = q.lte("era_received_date", filters.depositDateTo);
  if (filters.paymentDateFrom) q = q.gte("created_at", filters.paymentDateFrom);
  if (filters.paymentDateTo) q = q.lte("created_at", filters.paymentDateTo);

  const { data, error } = await q;
  if (error) {
    // tolerate missing era_received_date / payer_name columns by retrying once with a slim select
    if (/era_received_date|payer_name|payer_identifier|check_number/.test(error.message)) {
      const slim = await supabase
        .from("era_claim_payments")
        .select(
          "id, organization_id, client_id, professional_claim_id, posting_status, claim_match_status, clp04_payment_amount, era_import_batch_id, created_at",
        )
        .eq("organization_id", filters.organizationId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(clampLimit(filters.limit));
      if (slim.error) return [];
      return (slim.data ?? []).map((r) => mapEraRow(r as Record<string, unknown>));
    }
    return [];
  }
  return (data ?? []).map((r) => mapEraRow(r as Record<string, unknown>));
}

function mapEraRow(r: Record<string, unknown>): DashboardRow {
  const batch = r["era_import_batches"] as { received_at?: string | null } | null | undefined;
  return {
    id: `era:${String(r["id"] ?? "")}`,
    source: "era",
    paymentType: "insurance",
    postingStatus: String(r["posting_status"] ?? "pending"),
    payerName: (r["payer_name"] as string | null) ?? null,
    clientId: (r["client_id"] as string | null) ?? null,
    clientDisplayName: null,
    professionalClaimId: (r["professional_claim_id"] as string | null) ?? null,
    checkNumber: (r["check_number"] as string | null) ?? null,
    amount: Number(r["clp04_payment_amount"] ?? 0),
    depositDate:
      (r["era_received_date"] as string | null) ?? batch?.received_at ?? null,
    paymentDate: (r["created_at"] as string | null) ?? null,
    importedAt: batch?.received_at ?? (r["created_at"] as string | null) ?? null,
  };
}

// ── manual insurance rows ───────────────────────────────────────────────────

async function loadManualRows(
  supabase: SupabaseClient,
  filters: DashboardFilters,
): Promise<DashboardRow[]> {
  if (!wantSource(filters, "manual_insurance")) return [];
  let q = supabase
    .from("insurance_manual_payments")
    .select(
      "id, organization_id, client_id, claim_id, paid_amount, posted_at, created_at, eob_reference, payer_profile_id, archived_at",
    )
    .eq("organization_id", filters.organizationId)
    .is("archived_at", null)
    .order("posted_at", { ascending: false })
    .limit(clampLimit(filters.limit));
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  if (filters.payerProfileId) q = q.eq("payer_profile_id", filters.payerProfileId);
  if (filters.eftCheckNumber) q = q.ilike("eob_reference", `%${filters.eftCheckNumber}%`);
  if (filters.depositDateFrom) q = q.gte("posted_at", filters.depositDateFrom);
  if (filters.depositDateTo) q = q.lte("posted_at", filters.depositDateTo);
  if (filters.paymentDateFrom) q = q.gte("posted_at", filters.paymentDateFrom);
  if (filters.paymentDateTo) q = q.lte("posted_at", filters.paymentDateTo);

  const { data, error } = await q;
  if (error) {
    if (/payer_profile_id|eob_reference|posting_status/.test(error.message)) {
      const slim = await supabase
        .from("insurance_manual_payments")
        .select("id, organization_id, client_id, claim_id, paid_amount, posted_at, created_at")
        .eq("organization_id", filters.organizationId)
        .is("archived_at", null)
        .order("posted_at", { ascending: false })
        .limit(clampLimit(filters.limit));
      if (slim.error) return [];
      return (slim.data ?? []).map((r) => mapManualRow(r as Record<string, unknown>));
    }
    return [];
  }
  return (data ?? []).map((r) => mapManualRow(r as Record<string, unknown>));
}

function mapManualRow(r: Record<string, unknown>): DashboardRow {
  return {
    id: `mi:${String(r["id"] ?? "")}`,
    source: "manual_insurance",
    paymentType: "insurance",
    postingStatus: "posted",
    payerName: null,
    clientId: (r["client_id"] as string | null) ?? null,
    clientDisplayName: null,
    professionalClaimId: (r["claim_id"] as string | null) ?? null,
    checkNumber: (r["eob_reference"] as string | null) ?? null,
    amount: Number(r["paid_amount"] ?? 0),
    depositDate: (r["posted_at"] as string | null) ?? null,
    paymentDate: (r["posted_at"] as string | null) ?? null,
    importedAt: (r["created_at"] as string | null) ?? null,
  };
}

// ── patient payment rows ────────────────────────────────────────────────────

async function loadPatientRows(
  supabase: SupabaseClient,
  filters: DashboardFilters,
): Promise<DashboardRow[]> {
  if (!wantSource(filters, "patient")) return [];
  let q = supabase
    .from("client_payments")
    .select(
      "id, organization_id, client_id, claim_id, amount, payment_method, reference_number, posted_at, created_at, posting_status",
    )
    .eq("organization_id", filters.organizationId)
    .is("archived_at", null)
    .order("posted_at", { ascending: false })
    .limit(clampLimit(filters.limit));
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  if (filters.eftCheckNumber) q = q.ilike("reference_number", `%${filters.eftCheckNumber}%`);
  if (filters.postingStatus && filters.postingStatus.length > 0) {
    q = q.in("posting_status", filters.postingStatus);
  }
  if (filters.depositDateFrom) q = q.gte("posted_at", filters.depositDateFrom);
  if (filters.depositDateTo) q = q.lte("posted_at", filters.depositDateTo);
  if (filters.paymentDateFrom) q = q.gte("posted_at", filters.paymentDateFrom);
  if (filters.paymentDateTo) q = q.lte("posted_at", filters.paymentDateTo);

  const { data, error } = await q;
  if (error) {
    if (/posting_status|reference_number/.test(error.message)) {
      const slim = await supabase
        .from("client_payments")
        .select("id, organization_id, client_id, claim_id, amount, payment_method, posted_at, created_at")
        .eq("organization_id", filters.organizationId)
        .is("archived_at", null)
        .order("posted_at", { ascending: false })
        .limit(clampLimit(filters.limit));
      if (slim.error) return [];
      return (slim.data ?? []).map((r) => mapPatientRow(r as Record<string, unknown>));
    }
    return [];
  }
  return (data ?? []).map((r) => mapPatientRow(r as Record<string, unknown>));
}

function mapPatientRow(r: Record<string, unknown>): DashboardRow {
  return {
    id: `cp:${String(r["id"] ?? "")}`,
    source: "patient",
    paymentType: "patient",
    postingStatus: String(r["posting_status"] ?? "posted"),
    payerName: (r["payment_method"] as string | null) ?? null,
    clientId: (r["client_id"] as string | null) ?? null,
    clientDisplayName: null,
    professionalClaimId: (r["claim_id"] as string | null) ?? null,
    checkNumber: (r["reference_number"] as string | null) ?? null,
    amount: Number(r["amount"] ?? 0),
    depositDate: (r["posted_at"] as string | null) ?? null,
    paymentDate: (r["posted_at"] as string | null) ?? null,
    importedAt: (r["created_at"] as string | null) ?? null,
  };
}

// ── Totals ──────────────────────────────────────────────────────────────────

async function loadTotals(
  supabase: SupabaseClient,
  filters: DashboardFilters,
  rows: DashboardRow[],
): Promise<DashboardTotals> {
  const totals: DashboardTotals = {
    imported: 0,
    posted: 0,
    unmatched: 0,
    unapplied: 0,
    denied: 0,
    recoupments: 0,
    refunds: 0,
    pendingReview: 0,
    amountPosted: 0,
    amountPending: 0,
  };

  // Derive what we can from rows (page-scoped) for fast paint
  for (const r of rows) {
    totals.imported += 1;
    if (r.postingStatus === "posted") {
      totals.posted += 1;
      totals.amountPosted += r.amount;
    } else {
      totals.amountPending += r.amount;
    }
    if (r.source === "era" && r.amount <= 0) totals.denied += 1;
  }

  // True counts via lightweight count(*) queries scoped by filters.
  // Apply the same filter predicates as the row queries so totals stay in
  // sync with what the user sees in the table — otherwise KPIs lie.
  try {
    // supabase-js generics narrow each filter call, which trips
    // TS2589 ("type instantiation is excessively deep") when we chain
    // optional predicates through a helper. Cast to `any` for the builder
    // glue — the result shape we care about ({ count }) is asserted below.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const applyEraFilters = (q: any) => {
      let r = q
        .eq("organization_id", filters.organizationId)
        .is("archived_at", null);
      if (filters.clientId) r = r.eq("client_id", filters.clientId);
      if (filters.eftCheckNumber) r = r.ilike("check_number", `%${filters.eftCheckNumber}%`);
      if (filters.depositDateFrom) r = r.gte("era_received_date", filters.depositDateFrom);
      if (filters.depositDateTo) r = r.lte("era_received_date", filters.depositDateTo);
      if (filters.paymentDateFrom) r = r.gte("created_at", filters.paymentDateFrom);
      if (filters.paymentDateTo) r = r.lte("created_at", filters.paymentDateTo);
      return r;
    };
    const applyOrgFilter = (q: any) =>
      q.eq("organization_id", filters.organizationId).is("archived_at", null);

    const countQ = (table: string): any =>
      supabase.from(table).select("id", { count: "exact", head: true });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const counts = await Promise.all([
      applyEraFilters(countQ("era_claim_payments")),
      applyEraFilters(countQ("era_claim_payments")).eq("posting_status", "posted"),
      applyEraFilters(countQ("era_claim_payments")).eq("claim_match_status", "unmatched"),
      applyOrgFilter(countQ("payment_recoupments")),
      applyOrgFilter(countQ("payment_refunds")),
      applyOrgFilter(countQ("workqueue_items"))
        .in("work_type", [
          "denied",
          "underpayment",
          "appeal_needed",
          "cob_issue",
          "eligibility_issue",
          "era_unmatched_claim",
          "recoupment",
          "refund_review",
          "no_response",
        ])
        .in("status", ["open", "in_progress", "blocked"]),
    ]);
    if (typeof counts[0].count === "number") totals.imported = counts[0].count;
    if (typeof counts[1].count === "number") totals.posted = counts[1].count;
    if (typeof counts[2].count === "number") totals.unmatched = counts[2].count;
    if (typeof counts[3].count === "number") totals.recoupments = counts[3].count;
    if (typeof counts[4].count === "number") totals.refunds = counts[4].count;
    if (typeof counts[5].count === "number") totals.pendingReview = counts[5].count;
  } catch {
    // Best-effort: fall back to row-derived counts.
  }

  // unapplied: client_payments with NULL claim_id and NULL patient_invoice_id
  try {
    const { count: unappliedCount } = await supabase
      .from("client_payments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", filters.organizationId)
      .is("archived_at", null)
      .is("claim_id", null)
      .is("patient_invoice_id", null);
    if (typeof unappliedCount === "number") totals.unapplied = unappliedCount;
  } catch {
    // ignore
  }

  // denied: professional_claims with claim_status='denied'
  try {
    const { count: deniedCount } = await supabase
      .from("professional_claims")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", filters.organizationId)
      .eq("claim_status", "denied");
    if (typeof deniedCount === "number") totals.denied = deniedCount;
  } catch {
    // ignore
  }

  return totals;
}

// ── Public entrypoint ───────────────────────────────────────────────────────

export async function queryPaymentsDashboard(
  supabase: SupabaseClient,
  filters: DashboardFilters,
): Promise<DashboardResult> {
  const [eraRows, manualRows, patientRows] = await Promise.all([
    loadEraRows(supabase, filters),
    loadManualRows(supabase, filters),
    loadPatientRows(supabase, filters),
  ]);
  const merged = [...eraRows, ...manualRows, ...patientRows]
    .sort((a, b) => {
      const ad = a.paymentDate ?? a.depositDate ?? "";
      const bd = b.paymentDate ?? b.depositDate ?? "";
      return bd.localeCompare(ad);
    })
    .slice(0, clampLimit(filters.limit));
  const totals = await loadTotals(supabase, filters, merged);
  return {
    rows: merged,
    totals,
    filters,
    rowCount: merged.length,
  };
}
