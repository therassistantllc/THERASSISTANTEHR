/**
 * GET /api/billing/authorization-required
 *
 * Powers the Authorization Required workqueue. Returns rows across six
 * tabs (missing, expired, units_exhausted, wrong_provider,
 * wrong_service_code, pending) plus the supporting reference data the
 * detail panel needs (appointment history, documents, provider options
 * for the filter rail, etc.).
 *
 * Universal filter rail is honored server-side via query params:
 *   client, payer, clinician, practice, status, assignedBiller,
 *   dosFrom, dosTo, minAmount, agingBucket, priority, carcRarc, tab.
 *
 * Tenant isolation: every Supabase query filters by the session-derived
 * organizationId. Caller-supplied org ids are validated by
 * requireBillingAccess; never trusted for query scoping.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, any>;

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export type AuthTab =
  | "missing"
  | "expired"
  | "units_exhausted"
  | "wrong_provider"
  | "wrong_service_code"
  | "pending";

export interface AuthRow {
  id: string;
  tab: AuthTab;
  authId: string | null;
  claimId: string | null;
  clientId: string | null;
  clientName: string;
  payerProfileId: string | null;
  payerName: string;
  authorizationNumber: string | null;
  serviceCode: string | null;
  validFrom: string | null;
  validTo: string | null;
  unitsAuthorized: number | null;
  unitsUsed: number | null;
  unitsRemaining: number | null;
  expirationDate: string | null;
  claimDosAffected: string | null;
  chargeAmount: number;
  agingDays: number | null;
  riskLevel: "low" | "normal" | "high" | "urgent";
  createdAt: string | null;
  authStatus: string | null;
  insurancePolicyId: string | null;
  clinicianName: string | null;
  clinicianNpi: string | null;
  practiceName: string | null;
  expectedProviderNpi: string | null;
  observedProviderNpi: string | null;
  denialReason: string | null;
  assignedBillerName: string | null;
  // Earliest / latest service date across the affected claim's lines.
  // Null when the row has no associated claim (e.g. a pending auth with
  // no charges yet). Used by the DOS filter (`dosFrom`/`dosTo`).
  claimDosFrom: string | null;
  claimDosTo: string | null;
}

export interface AppointmentSummary {
  id: string;
  clientId: string;
  scheduledStartAt: string | null;
  appointmentStatus: string | null;
  appointmentType: string | null;
  providerName: string | null;
}

export interface DocumentSummary {
  id: string;
  clientId: string | null;
  title: string;
  documentType: string | null;
  fileName: string;
  uploadedAt: string | null;
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 3600 * 1000));
}

function computeRisk(args: {
  tab: AuthTab;
  validTo: string | null;
}): AuthRow["riskLevel"] {
  if (args.tab === "missing" || args.tab === "units_exhausted") return "urgent";
  if (args.tab === "expired") return "urgent";
  if (args.tab === "wrong_provider" || args.tab === "wrong_service_code") return "high";
  if (args.tab === "pending") {
    const d = daysUntil(args.validTo);
    if (d != null && d <= 7) return "high";
    return "normal";
  }
  return "normal";
}

function fmtName(c: DbRow | undefined): string {
  if (!c) return "Unknown client";
  return [c.first_name, c.last_name].map(text).filter(Boolean).join(" ") || "Unknown client";
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // Filter rail params (all optional)
    const filters = {
      tab: text(searchParams.get("tab")) || null,
      client: text(searchParams.get("client")) || null,
      payer: text(searchParams.get("payer")) || null,
      clinician: text(searchParams.get("clinician")) || null,
      practice: text(searchParams.get("practice")) || null,
      status: text(searchParams.get("status")) || null,
      assignedBiller: text(searchParams.get("assignedBiller")) || null,
      dosFrom: text(searchParams.get("dosFrom")) || null,
      dosTo: text(searchParams.get("dosTo")) || null,
      minAmount: searchParams.get("minAmount")
        ? Number(searchParams.get("minAmount"))
        : null,
      agingBucket: text(searchParams.get("agingBucket")) || null,
      priority: text(searchParams.get("priority")) || null,
      carcRarc: text(searchParams.get("carcRarc")) || null,
      followUpDue: text(searchParams.get("followUpDue")) || null,
    } as const;

    const today = new Date().toISOString().slice(0, 10);

    // 1) Active auth_or_referrals rows
    const { data: authsRaw, error: authsErr } = await (supabase as any)
      .from("authorization_or_referrals")
      .select(
        "id, client_id, insurance_policy_id, appointment_id, auth_type, authorization_status, authorization_number, service_code, units_authorized, units_used, valid_from, valid_to, denial_reason, created_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (authsErr) throw authsErr;
    const auths = (authsRaw as DbRow[]) ?? [];

    // 2) Active professional_claims (for "missing" + claim/DOS join)
    const { data: claimsRaw, error: claimsErr } = await (supabase as any)
      .from("professional_claims")
      .select(
        "id, claim_number, patient_id, appointment_id, payer_profile_id, prior_authorization_number, total_charge, defer_until, claim_status, denial_reason_description, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (claimsErr) throw claimsErr;
    const claims = (claimsRaw as DbRow[]) ?? [];

    // 3) Insurance policies — load both the ones referenced by auths AND
    //    every active policy for every client we touched, so missing-auth
    //    rows can resolve a policy_id from (client_id, payer_id).
    const clientIdsForPolicies = Array.from(
      new Set([
        ...auths.map((a) => text(a.client_id)),
        ...claims.map((c) => text(c.patient_id)),
      ]).values(),
    ).filter(Boolean);
    const { data: policiesRaw } = clientIdsForPolicies.length
      ? await (supabase as any)
          .from("insurance_policies")
          .select("id, payer_id, client_id, priority, active_flag, archived_at")
          .eq("organization_id", organizationId)
          .in("client_id", clientIdsForPolicies)
      : { data: [] as DbRow[] };
    const policyById = new Map<string, DbRow>(
      ((policiesRaw as DbRow[]) ?? []).map((p) => [text(p.id), p]),
    );
    // (clientId, payerId) → best policy (active + primary preferred)
    const policyByClientPayer = new Map<string, DbRow>();
    for (const p of ((policiesRaw as DbRow[]) ?? [])) {
      if (p.archived_at) continue;
      if (p.active_flag === false) continue;
      const key = `${text(p.client_id)}::${text(p.payer_id)}`;
      const prev = policyByClientPayer.get(key);
      if (!prev) {
        policyByClientPayer.set(key, p);
        continue;
      }
      const rank = (r: DbRow) => (text(r.priority) === "primary" ? 0 : 1);
      if (rank(p) < rank(prev)) policyByClientPayer.set(key, p);
    }

    // 4) Payer profiles
    const payerIds = Array.from(
      new Set([
        ...((policiesRaw as DbRow[]) ?? []).map((p) => text(p.payer_id)),
        ...claims.map((c) => text(c.payer_profile_id)),
      ]).values(),
    ).filter(Boolean);
    const { data: payersRaw } = payerIds.length
      ? await (supabase as any)
          .from("payer_profiles")
          .select("id, payer_name, requires_authorization")
          .eq("organization_id", organizationId)
          .in("id", payerIds)
      : { data: [] as DbRow[] };
    const payerById = new Map<string, DbRow>(
      ((payersRaw as DbRow[]) ?? []).map((p) => [text(p.id), p]),
    );

    // 5) Clients
    const clientIds = Array.from(
      new Set([
        ...auths.map((a) => text(a.client_id)),
        ...claims.map((c) => text(c.patient_id)),
      ]).values(),
    ).filter(Boolean);
    const { data: clientsRaw } = clientIds.length
      ? await (supabase as any)
          .from("clients")
          .select("id, first_name, last_name")
          .eq("organization_id", organizationId)
          .in("id", clientIds)
      : { data: [] as DbRow[] };
    const clientById = new Map<string, DbRow>(
      ((clientsRaw as DbRow[]) ?? []).map((c) => [text(c.id), c]),
    );

    // 6) Service lines (for wrong_service_code, DOS labels, NPI mismatch)
    const claimIds = claims.map((c) => text(c.id)).filter(Boolean);
    const { data: linesRaw } = claimIds.length
      ? await (supabase as any)
          .from("professional_claim_service_lines")
          .select(
            "claim_id, line_number, procedure_code, service_date_from, service_date_to, authorization_number, units, charge_amount, rendering_provider_npi",
          )
          .in("claim_id", claimIds)
          .order("line_number", { ascending: true })
      : { data: [] as DbRow[] };
    const lines = ((linesRaw as DbRow[]) ?? []);
    const linesByClaim = new Map<string, DbRow[]>();
    for (const ln of lines) {
      const cid = text(ln.claim_id);
      if (!linesByClaim.has(cid)) linesByClaim.set(cid, []);
      linesByClaim.get(cid)!.push(ln);
    }

    // 7) Appointments (auth.appointment_id, claim.appointment_id, and a
    //    short recent history per client for the detail panel)
    const appointmentIds = Array.from(
      new Set(
        [
          ...auths.map((a) => text(a.appointment_id)),
          ...claims.map((c) => text(c.appointment_id)),
        ].filter(Boolean),
      ),
    );
    const { data: directApptsRaw } = appointmentIds.length
      ? await (supabase as any)
          .from("appointments")
          .select(
            "id, client_id, provider_id, provider_location_id, scheduled_start_at, appointment_status, appointment_type",
          )
          .eq("organization_id", organizationId)
          .in("id", appointmentIds)
      : { data: [] as DbRow[] };
    const { data: clientApptsRaw } = clientIds.length
      ? await (supabase as any)
          .from("appointments")
          .select(
            "id, client_id, provider_id, provider_location_id, scheduled_start_at, appointment_status, appointment_type",
          )
          .eq("organization_id", organizationId)
          .in("client_id", clientIds)
          .order("scheduled_start_at", { ascending: false })
          .limit(200)
      : { data: [] as DbRow[] };
    const appointmentsAll = new Map<string, DbRow>();
    for (const a of ((directApptsRaw as DbRow[]) ?? [])) appointmentsAll.set(text(a.id), a);
    for (const a of ((clientApptsRaw as DbRow[]) ?? [])) appointmentsAll.set(text(a.id), a);

    // 8) Providers (for NPI lookup + clinician filter options)
    const providerIds = Array.from(
      new Set(
        Array.from(appointmentsAll.values())
          .map((a) => text(a.provider_id))
          .filter(Boolean),
      ),
    );
    const { data: providersRaw } = providerIds.length
      ? await (supabase as any)
          .from("providers")
          .select("id, first_name, last_name, npi")
          .eq("organization_id", organizationId)
          .in("id", providerIds)
      : { data: [] as DbRow[] };
    const providerById = new Map<string, DbRow>(
      ((providersRaw as DbRow[]) ?? []).map((p) => [text(p.id), p]),
    );
    const providerNameOf = (id: string | null): string | null => {
      if (!id) return null;
      const p = providerById.get(id);
      if (!p) return null;
      return [p.first_name, p.last_name].map(text).filter(Boolean).join(" ") || null;
    };

    // 9) Provider locations (for practice filter options)
    const locationIds = Array.from(
      new Set(
        Array.from(appointmentsAll.values())
          .map((a) => text(a.provider_location_id))
          .filter(Boolean),
      ),
    );
    const { data: locationsRaw } = locationIds.length
      ? await (supabase as any)
          .from("provider_locations")
          .select("id, location_name")
          .eq("organization_id", organizationId)
          .in("id", locationIds)
      : { data: [] as DbRow[] };
    const locationById = new Map<string, DbRow>(
      ((locationsRaw as DbRow[]) ?? []).map((l) => [text(l.id), l]),
    );

    // 10) Documents (for the "Uploaded auth documents" detail tab)
    const { data: docsRaw } = clientIds.length
      ? await (supabase as any)
          .from("documents")
          .select(
            "id, client_id, claim_id, title, document_type, document_scope, file_name, created_at",
          )
          .eq("organization_id", organizationId)
          .in("client_id", clientIds)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] as DbRow[] };
    const allDocs = ((docsRaw as DbRow[]) ?? []);

    // ── Helpers / lookups ──
    const authByNumber = new Map<string, DbRow>();
    for (const a of auths) {
      const k = text(a.authorization_number);
      if (k) authByNumber.set(k, a);
    }

    function payerForAuth(a: DbRow): DbRow | undefined {
      const pol = policyById.get(text(a.insurance_policy_id));
      if (!pol) return undefined;
      return payerById.get(text(pol.payer_id));
    }
    function policyForAuth(a: DbRow): DbRow | undefined {
      return policyById.get(text(a.insurance_policy_id));
    }

    function claimDosRange(
      claim: DbRow | null | undefined,
    ): { from: string | null; to: string | null } {
      if (!claim) return { from: null, to: null };
      const ls = linesByClaim.get(text(claim.id)) ?? [];
      if (ls.length === 0) return { from: null, to: null };
      let from: string | null = null;
      let to: string | null = null;
      for (const ln of ls) {
        const f = text(ln.service_date_from);
        const t = text(ln.service_date_to) || f;
        if (f && (!from || f < from)) from = f;
        if (t && (!to || t > to)) to = t;
      }
      return { from, to };
    }

    function dosLabel(claim: DbRow | null | undefined): string | null {
      if (!claim) return null;
      const { from, to } = claimDosRange(claim);
      if (!from) return null;
      const claimNo = text(claim.claim_number) || text(claim.id).slice(0, 8);
      return to && to !== from ? `${claimNo} · ${from} – ${to}` : `${claimNo} · ${from}`;
    }

    function expectedNpiForAuth(a: DbRow): { npi: string | null; providerId: string | null } {
      const appt = appointmentsAll.get(text(a.appointment_id));
      if (!appt) return { npi: null, providerId: null };
      const provider = providerById.get(text(appt.provider_id));
      return {
        npi: text(provider?.npi) || null,
        providerId: text(appt.provider_id) || null,
      };
    }

    function clinicianForRow(a: DbRow): { name: string | null; npi: string | null } {
      const expected = expectedNpiForAuth(a);
      if (expected.providerId) {
        return { name: providerNameOf(expected.providerId), npi: expected.npi };
      }
      return { name: null, npi: null };
    }

    function practiceForAuth(a: DbRow): string | null {
      const appt = appointmentsAll.get(text(a.appointment_id));
      if (!appt) return null;
      const loc = locationById.get(text(appt.provider_location_id));
      return text(loc?.location_name) || null;
    }

    function authRowBase(a: DbRow, tab: AuthTab, claim?: DbRow): AuthRow {
      const payer = payerForAuth(a);
      const policy = policyForAuth(a);
      const client = clientById.get(text(a.client_id));
      const unitsAuth = a.units_authorized == null ? null : Number(a.units_authorized);
      const unitsUsed = a.units_used == null ? null : Number(a.units_used);
      const remaining =
        unitsAuth != null && unitsUsed != null ? Math.max(0, unitsAuth - unitsUsed) : null;
      const clin = clinicianForRow(a);
      const dos = claimDosRange(claim);
      return {
        id: `${tab}:auth:${text(a.id)}${claim ? `:claim:${text(claim.id)}` : ""}`,
        tab,
        authId: text(a.id),
        claimId: claim ? text(claim.id) : null,
        clientId: text(a.client_id) || null,
        clientName: fmtName(client),
        payerProfileId: payer ? text(payer.id) : null,
        payerName: text(payer?.payer_name) || "—",
        authorizationNumber: text(a.authorization_number) || null,
        serviceCode: text(a.service_code) || null,
        validFrom: a.valid_from ?? null,
        validTo: a.valid_to ?? null,
        unitsAuthorized: unitsAuth,
        unitsUsed: unitsUsed,
        unitsRemaining: remaining,
        expirationDate: a.valid_to ?? null,
        claimDosAffected: dosLabel(claim),
        chargeAmount: claim ? money(claim.total_charge) : 0,
        agingDays: ageDays(a.created_at),
        riskLevel: computeRisk({ tab, validTo: a.valid_to }),
        createdAt: a.created_at ?? null,
        authStatus: text(a.authorization_status) || null,
        insurancePolicyId: policy ? text(policy.id) : null,
        clinicianName: clin.name,
        clinicianNpi: clin.npi,
        practiceName: practiceForAuth(a),
        expectedProviderNpi: clin.npi,
        observedProviderNpi: null,
        denialReason: text(a.denial_reason) || null,
        assignedBillerName: null,
        claimDosFrom: dos.from,
        claimDosTo: dos.to,
      };
    }

    const rows: AuthRow[] = [];

    // Pending
    for (const a of auths) {
      if (text(a.authorization_status) === "pending") rows.push(authRowBase(a, "pending"));
    }
    // Expired
    for (const a of auths) {
      const status = text(a.authorization_status);
      const validTo = text(a.valid_to);
      const expiredByDate = validTo && validTo < today && status === "approved";
      if (status === "expired" || expiredByDate) rows.push(authRowBase(a, "expired"));
    }
    // Units exhausted
    for (const a of auths) {
      if (text(a.authorization_status) !== "approved") continue;
      const ua = a.units_authorized == null ? null : Number(a.units_authorized);
      const uu = a.units_used == null ? null : Number(a.units_used);
      if (ua != null && ua > 0 && uu != null && uu >= ua) {
        rows.push(authRowBase(a, "units_exhausted"));
      }
    }
    // Wrong service code
    const seenWrongCode = new Set<string>();
    for (const ln of lines) {
      const num = text(ln.authorization_number);
      if (!num) continue;
      const a = authByNumber.get(num);
      if (!a) continue;
      const expected = text(a.service_code);
      const got = text(ln.procedure_code);
      if (!expected || !got || expected === got) continue;
      const claim = claims.find((c) => text(c.id) === text(ln.claim_id));
      const key = `${text(a.id)}:${text(ln.claim_id)}:${ln.line_number}`;
      if (seenWrongCode.has(key)) continue;
      seenWrongCode.add(key);
      const row = authRowBase(a, "wrong_service_code", claim);
      row.claimDosAffected = `${dosLabel(claim) ?? text(claim?.claim_number) ?? "—"} · ${got} (expected ${expected})`;
      rows.push(row);
    }
    // Wrong provider — claim line bills under an NPI that doesn't match the
    // provider on the auth's referenced appointment.
    const seenWrongProvider = new Set<string>();
    for (const ln of lines) {
      const num = text(ln.authorization_number);
      const observed = text(ln.rendering_provider_npi);
      if (!num || !observed) continue;
      const a = authByNumber.get(num);
      if (!a) continue;
      const expected = expectedNpiForAuth(a).npi;
      if (!expected) continue;
      if (expected === observed) continue;
      const claim = claims.find((c) => text(c.id) === text(ln.claim_id));
      const key = `${text(a.id)}:${text(ln.claim_id)}:${ln.line_number}`;
      if (seenWrongProvider.has(key)) continue;
      seenWrongProvider.add(key);
      const row = authRowBase(a, "wrong_provider", claim);
      row.observedProviderNpi = observed;
      row.expectedProviderNpi = expected;
      row.claimDosAffected = `${dosLabel(claim) ?? text(claim?.claim_number) ?? "—"} · NPI ${observed} (expected ${expected})`;
      rows.push(row);
    }
    // Missing authorization — claim against payer that requires it, with
    // no prior_authorization_number on file.
    for (const c of claims) {
      const payer = payerById.get(text(c.payer_profile_id));
      if (!payer || !payer.requires_authorization) continue;
      if (text(c.prior_authorization_number)) continue;
      const client = clientById.get(text(c.patient_id));
      const ls = linesByClaim.get(text(c.id)) ?? [];
      const first = ls[0];
      const last = ls[ls.length - 1];
      const dosFrom = text(first?.service_date_from) || null;
      const dosTo = text(last?.service_date_to) || text(last?.service_date_from) || null;
      const appt = appointmentsAll.get(text(c.appointment_id));
      const providerId = appt ? text(appt.provider_id) : null;
      const loc = appt ? locationById.get(text(appt.provider_location_id)) : null;
      rows.push({
        id: `missing:claim:${text(c.id)}`,
        tab: "missing",
        authId: null,
        claimId: text(c.id),
        clientId: text(c.patient_id) || null,
        clientName: fmtName(client),
        payerProfileId: text(payer.id),
        payerName: text(payer.payer_name) || "—",
        authorizationNumber: null,
        serviceCode: text(first?.procedure_code) || null,
        validFrom: null,
        validTo: null,
        unitsAuthorized: null,
        unitsUsed: null,
        unitsRemaining: null,
        expirationDate: null,
        claimDosAffected:
          dosFrom && dosTo && dosTo !== dosFrom
            ? `${text(c.claim_number) || text(c.id).slice(0, 8)} · ${dosFrom} – ${dosTo}`
            : dosFrom
              ? `${text(c.claim_number) || text(c.id).slice(0, 8)} · ${dosFrom}`
              : text(c.claim_number) || text(c.id).slice(0, 8),
        chargeAmount: money(c.total_charge),
        agingDays: ageDays(c.created_at),
        riskLevel: "urgent",
        createdAt: c.created_at ?? null,
        authStatus: null,
        insurancePolicyId:
          text(policyByClientPayer.get(`${text(c.patient_id)}::${text(payer.id)}`)?.id) ||
          null,
        clinicianName: providerNameOf(providerId),
        clinicianNpi: providerId ? text(providerById.get(providerId)?.npi) || null : null,
        practiceName: text(loc?.location_name) || null,
        expectedProviderNpi: null,
        observedProviderNpi: text(first?.rendering_provider_npi) || null,
        denialReason: text(c.denial_reason_description) || null,
        assignedBillerName: null,
        claimDosFrom: dosFrom,
        claimDosTo: dosTo,
      });
    }

    // ── Apply universal filter rail (server-side) ──
    const inAgingBucket = (a: number | null, bucket: string | null) => {
      if (!bucket) return true;
      if (a == null) return false;
      switch (bucket) {
        case "0-30":
          return a <= 30;
        case "31-60":
          return a > 30 && a <= 60;
        case "61-90":
          return a > 60 && a <= 90;
        case "90+":
          return a > 90;
        default:
          return true;
      }
    };
    const clientNeedle = filters.client?.toLowerCase() ?? "";
    const carcNeedle = filters.carcRarc?.toLowerCase() ?? "";

    const filteredRows = rows.filter((r) => {
      if (filters.tab && r.tab !== filters.tab) return false;
      if (clientNeedle && !r.clientName.toLowerCase().includes(clientNeedle)) return false;
      if (filters.payer && r.payerName !== filters.payer) return false;
      if (filters.clinician && r.clinicianName !== filters.clinician) return false;
      if (filters.practice && r.practiceName !== filters.practice) return false;
      if (filters.status && r.authStatus !== filters.status) return false;
      if (filters.priority && r.riskLevel !== filters.priority) return false;
      // DOS filter applies to the affected claim's service-line dates. Rows
      // with no associated claim/DOS are excluded when either dosFrom or
      // dosTo is set so the queue can't silently pass them through.
      if (filters.dosFrom || filters.dosTo) {
        if (!r.claimDosFrom && !r.claimDosTo) return false;
        if (filters.dosFrom && (r.claimDosTo ?? r.claimDosFrom ?? "") < filters.dosFrom)
          return false;
        if (filters.dosTo && (r.claimDosFrom ?? r.claimDosTo ?? "") > filters.dosTo)
          return false;
      }
      if (
        filters.minAmount != null &&
        Number.isFinite(filters.minAmount) &&
        r.chargeAmount < (filters.minAmount as number)
      )
        return false;
      if (!inAgingBucket(r.agingDays, filters.agingBucket)) return false;
      if (carcNeedle && !(r.denialReason ?? "").toLowerCase().includes(carcNeedle)) return false;
      if (
        filters.followUpDue &&
        (r.expirationDate ?? "9999-12-31") > filters.followUpDue
      )
        return false;
      // assignedBiller currently always null in our data; only "Unassigned"
      // matches every row, so we treat any explicit non-"Unassigned" value
      // as an empty result set.
      if (filters.assignedBiller && filters.assignedBiller !== "Unassigned") return false;
      return true;
    });

    // Tab counts computed BEFORE the tab filter so the strip shows the
    // count of items in each tab under the other active filters.
    const baseForCounts = rows.filter((r) => {
      if (clientNeedle && !r.clientName.toLowerCase().includes(clientNeedle)) return false;
      if (filters.payer && r.payerName !== filters.payer) return false;
      if (filters.clinician && r.clinicianName !== filters.clinician) return false;
      if (filters.practice && r.practiceName !== filters.practice) return false;
      if (filters.status && r.authStatus !== filters.status) return false;
      if (filters.priority && r.riskLevel !== filters.priority) return false;
      if (filters.dosFrom || filters.dosTo) {
        if (!r.claimDosFrom && !r.claimDosTo) return false;
        if (filters.dosFrom && (r.claimDosTo ?? r.claimDosFrom ?? "") < filters.dosFrom)
          return false;
        if (filters.dosTo && (r.claimDosFrom ?? r.claimDosTo ?? "") > filters.dosTo)
          return false;
      }
      if (
        filters.minAmount != null &&
        Number.isFinite(filters.minAmount) &&
        r.chargeAmount < (filters.minAmount as number)
      )
        return false;
      if (!inAgingBucket(r.agingDays, filters.agingBucket)) return false;
      if (carcNeedle && !(r.denialReason ?? "").toLowerCase().includes(carcNeedle)) return false;
      if (
        filters.followUpDue &&
        (r.expirationDate ?? "9999-12-31") > filters.followUpDue
      )
        return false;
      if (filters.assignedBiller && filters.assignedBiller !== "Unassigned") return false;
      return true;
    });
    const tabCounts: Record<AuthTab, number> = {
      missing: 0,
      expired: 0,
      units_exhausted: 0,
      wrong_provider: 0,
      wrong_service_code: 0,
      pending: 0,
    };
    for (const r of baseForCounts) tabCounts[r.tab] += 1;

    // ── Reference data for the rail + detail panel ──
    const payerOptions = Array.from(
      new Set(rows.map((r) => r.payerName).filter((n) => n && n !== "—")),
    ).map((n) => ({ value: n, label: n }));
    const clinicianOptions = Array.from(
      new Set(rows.map((r) => r.clinicianName).filter((n): n is string => Boolean(n))),
    ).map((n) => ({ value: n, label: n }));
    const practiceOptions = Array.from(
      new Set(rows.map((r) => r.practiceName).filter((n): n is string => Boolean(n))),
    ).map((n) => ({ value: n, label: n }));

    // Appointment history per client (most recent 5)
    const appointmentsByClient: Record<string, AppointmentSummary[]> = {};
    for (const a of Array.from(appointmentsAll.values())) {
      const cid = text(a.client_id);
      if (!cid) continue;
      if (!appointmentsByClient[cid]) appointmentsByClient[cid] = [];
      appointmentsByClient[cid].push({
        id: text(a.id),
        clientId: cid,
        scheduledStartAt: a.scheduled_start_at ?? null,
        appointmentStatus: text(a.appointment_status) || null,
        appointmentType: text(a.appointment_type) || null,
        providerName: providerNameOf(text(a.provider_id)),
      });
    }
    for (const cid of Object.keys(appointmentsByClient)) {
      appointmentsByClient[cid].sort((x, y) =>
        (y.scheduledStartAt ?? "").localeCompare(x.scheduledStartAt ?? ""),
      );
      appointmentsByClient[cid] = appointmentsByClient[cid].slice(0, 5);
    }

    // Documents per client (auth-relevant types)
    const documentsByClient: Record<string, DocumentSummary[]> = {};
    for (const d of allDocs) {
      const cid = text(d.client_id);
      if (!cid) continue;
      const type = text(d.document_type).toLowerCase();
      const scope = text(d.document_scope).toLowerCase();
      const looksAuth =
        type.includes("auth") ||
        type.includes("referral") ||
        scope === "claim" ||
        scope === "mailroom";
      if (!looksAuth) continue;
      if (!documentsByClient[cid]) documentsByClient[cid] = [];
      documentsByClient[cid].push({
        id: text(d.id),
        clientId: cid,
        title: text(d.title) || text(d.file_name),
        documentType: type || null,
        fileName: text(d.file_name),
        uploadedAt: d.created_at ?? null,
      });
    }
    for (const cid of Object.keys(documentsByClient)) {
      documentsByClient[cid] = documentsByClient[cid].slice(0, 10);
    }

    return NextResponse.json({
      success: true,
      organizationId,
      rows: filteredRows,
      tabCounts,
      filters,
      payerOptions,
      clinicianOptions,
      practiceOptions,
      assignedBillerOptions: [{ value: "Unassigned", label: "Unassigned" }],
      statusOptions: [
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "denied", label: "Denied" },
        { value: "expired", label: "Expired" },
        { value: "cancelled", label: "Cancelled" },
        { value: "not_required", label: "Not required" },
      ],
      appointmentsByClient,
      documentsByClient,
    });
  } catch (e) {
    console.error("Authorization-required API error:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
