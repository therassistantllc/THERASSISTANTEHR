/**
 * GET /api/billing/claim-build-errors
 *
 * Powers the Claim Build Errors workqueue (/billing/claim-build-errors).
 * Scans every not-yet-submitted professional claim in the org, runs the
 * Claim Content Validation engine on each one, and emits one row per
 * blocking finding — bucketed into the 7 tabs from the spec.
 *
 * Honors the universal filter rail server-side: payer/client/status,
 * DOS range, amount range, aging bucket, priority, practice, clinician,
 * assigned biller, CARC/RARC, follow-up due. Filters are applied
 * post-validation because rule findings (the row unit) are computed
 * in-memory; pre-filtering at the claim level is done for cheap
 * narrowing (payer / client / status / DOS / amount).
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { runClaimContentValidation } from "@/lib/validation/claim/runClaimContentValidation";
import {
  BUILD_HOLD_DEFER_UNTIL,
  describeRule,
  DEFERRED_REASON_HOLD,
  DEFERRED_REASON_ROUTED,
  type BuildErrorTabId,
} from "@/lib/billing/claimBuildErrors";

const NOT_SUBMITTED_STATUSES = [
  "draft",
  "ready_for_validation",
  "validation_failed",
];

const MAX_CLAIMS = 500;

interface RowOut {
  id: string;
  claimId: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  clinicianName: string | null;
  practiceName: string | null;
  dos: string | null;
  totalCharge: number;
  ruleId: string;
  tab: BuildErrorTabId;
  errorType: string;
  missingField: string;
  fieldLocation: string;
  severity: "blocking" | "warning" | "info";
  assignedTo: string | null;
  lastAttemptedBuild: string | null;
  status: "open" | "held" | "routed";
  fixRoute: string;
  whyItMatters: string;
  resolution: string;
  agingDays: number | null;
  followUpDue: string | null;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function bucketMatch(age: number | null, bucket: string | null): boolean {
  if (!bucket) return true;
  const a = age ?? 0;
  switch (bucket) {
    case "0-7": return a <= 7;
    case "8-30": return a >= 8 && a <= 30;
    case "31-60": return a >= 31 && a <= 60;
    case "60+": return a > 60;
    default: return true;
  }
}

function ciContains(haystack: string | null, needle: string | null): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
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

    const f = {
      payer: searchParams.get("payer"),
      client: searchParams.get("client"),
      status: searchParams.get("status"),
      dosFrom: searchParams.get("dosFrom"),
      dosTo: searchParams.get("dosTo"),
      minAmount: searchParams.get("minAmount"),
      maxAmount: searchParams.get("maxAmount"),
      agingBucket: searchParams.get("agingBucket"),
      priority: searchParams.get("priority"),
      practice: searchParams.get("practice"),
      clinician: searchParams.get("clinician"),
      assignedBiller: searchParams.get("assignedBiller"),
      carcRarc: searchParams.get("carcRarc"),
      followUpDue: searchParams.get("followUpDue"),
    };

    // Pre-filter at the claim level for cheap narrowing.
    let claimsQuery = (supabase as any)
      .from("professional_claims")
      .select(
        "id, claim_number, claim_status, patient_id, payer_profile_id, total_charge, created_at, updated_at, last_validated_at, defer_until, deferred_reason",
      )
      .eq("organization_id", organizationId)
      .in("claim_status", NOT_SUBMITTED_STATUSES)
      .is("archived_at", null);

    if (f.payer) claimsQuery = claimsQuery.eq("payer_profile_id", f.payer);
    if (f.client) claimsQuery = claimsQuery.eq("patient_id", f.client);
    if (f.minAmount && Number.isFinite(Number(f.minAmount))) {
      claimsQuery = claimsQuery.gte("total_charge", Number(f.minAmount));
    }
    if (f.maxAmount && Number.isFinite(Number(f.maxAmount))) {
      claimsQuery = claimsQuery.lte("total_charge", Number(f.maxAmount));
    }

    const { data: claimRows, error: claimsError } = await claimsQuery
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(MAX_CLAIMS);

    if (claimsError) throw claimsError;

    const claims = (claimRows ?? []) as Array<Record<string, unknown>>;
    if (claims.length === 0) {
      return NextResponse.json({ success: true, items: [] });
    }

    const clientIds = [
      ...new Set(claims.map((c) => text(c.patient_id)).filter(Boolean)),
    ];
    const payerIds = [
      ...new Set(claims.map((c) => text(c.payer_profile_id)).filter(Boolean)),
    ];
    const claimIds = claims.map((c) => text(c.id)).filter(Boolean);

    const [
      { data: clients },
      { data: payers },
      { data: serviceLines },
      { data: parties },
    ] = await Promise.all([
      clientIds.length
        ? (supabase as any)
            .from("clients")
            .select("id, first_name, last_name")
            .in("id", clientIds)
        : Promise.resolve({ data: [] }),
      payerIds.length
        ? (supabase as any)
            .from("payer_profiles")
            .select("id, payer_name")
            .in("id", payerIds)
        : Promise.resolve({ data: [] }),
      claimIds.length
        ? (supabase as any)
            .from("professional_claim_service_lines")
            .select("claim_id, service_date_from")
            .in("claim_id", claimIds)
        : Promise.resolve({ data: [] }),
      claimIds.length
        ? (supabase as any)
            .from("claim_parties_snapshot")
            .select("claim_id, parties")
            .in("claim_id", claimIds)
        : Promise.resolve({ data: [] }),
    ]);

    const clientById = new Map<string, { first: string; last: string }>(
      ((clients ?? []) as Array<Record<string, unknown>>).map((r) => [
        text(r.id),
        { first: text(r.first_name), last: text(r.last_name) },
      ]),
    );
    const payerById = new Map<string, string>(
      ((payers ?? []) as Array<Record<string, unknown>>).map((r) => [
        text(r.id),
        text(r.payer_name) || "—",
      ]),
    );
    const earliestDosByClaim = new Map<string, string>();
    for (const sl of (serviceLines ?? []) as Array<Record<string, unknown>>) {
      const claimId = text(sl.claim_id);
      const dos = text(sl.service_date_from);
      if (!claimId || !dos) continue;
      const prev = earliestDosByClaim.get(claimId);
      if (!prev || dos < prev) earliestDosByClaim.set(claimId, dos);
    }
    const partiesByClaim = new Map<string, Record<string, unknown>>();
    for (const p of (parties ?? []) as Array<Record<string, unknown>>) {
      const claimId = text(p.claim_id);
      if (claimId) partiesByClaim.set(claimId, (p.parties as Record<string, unknown>) ?? {});
    }

    // Run content validation on each claim in parallel.
    const results = await Promise.allSettled(
      claims.map((c) =>
        runClaimContentValidation(supabase as any, organizationId, text(c.id)),
      ),
    );

    const today = new Date().toISOString().slice(0, 10);
    const rows: RowOut[] = [];

    for (let i = 0; i < claims.length; i++) {
      const c = claims[i];
      const r = results[i];
      if (r.status !== "fulfilled") continue;
      const findings = r.value.report.findings.filter(
        (f) => f.severity === "blocking",
      );
      if (findings.length === 0) continue;

      const claimId = text(c.id);
      const clientId = text(c.patient_id) || null;
      const client = clientId ? clientById.get(clientId) : null;
      const clientName = client
        ? `${client.last}, ${client.first}`.trim().replace(/^,\s*/, "")
        : "—";
      const payerId = text(c.payer_profile_id) || null;
      const payerName = payerId ? payerById.get(payerId) ?? null : null;
      const deferUntil = text(c.defer_until) || null;
      const deferredReason = text(c.deferred_reason) || null;
      const isFutureDefer = !!(deferUntil && deferUntil > today);
      const status: RowOut["status"] = isFutureDefer
        ? deferredReason === DEFERRED_REASON_ROUTED
          ? "routed"
          : "held"
        : "open";

      // Pull clinician / practice from parties snapshot.
      const partiesObj = partiesByClaim.get(claimId) ?? {};
      const clinicianName =
        text(partiesObj.rendering_provider_name) ||
        [text(partiesObj.rendering_provider_first_name), text(partiesObj.rendering_provider_last_name)]
          .filter(Boolean)
          .join(" ") ||
        null;
      const practiceName =
        text(partiesObj.service_facility_name) ||
        text(partiesObj.billing_provider_name) ||
        null;

      const dos = earliestDosByClaim.get(claimId) ?? null;
      const aging = ageDays(text(c.created_at) || null);

      // Row-level filter pass (covers everything not pushed down to SQL).
      if (f.dosFrom && (!dos || dos < f.dosFrom)) continue;
      if (f.dosTo && (!dos || dos > f.dosTo)) continue;
      if (!bucketMatch(aging, f.agingBucket)) continue;
      if (f.priority === "urgent" && (aging ?? 0) <= 14) continue;
      if (f.practice && !ciContains(practiceName, f.practice)) continue;
      if (f.clinician && !ciContains(clinicianName, f.clinician)) continue;
      if (f.followUpDue && deferUntil !== f.followUpDue) continue;

      for (const finding of findings) {
        const meta = describeRule(finding.ruleId);
        // Status filter (the row's effective status).
        if (f.status && status !== f.status) continue;
        // CARC/RARC isn't issued at build time, so we let users match
        // against ruleId or error-type text for a useful proxy.
        if (
          f.carcRarc &&
          !ciContains(finding.ruleId, f.carcRarc) &&
          !ciContains(meta.errorType, f.carcRarc)
        ) {
          continue;
        }
        // assignedBiller: row-level assignment isn't modeled yet
        // (separate follow-up). When unset, only "unassigned" / "—"
        // queries match.
        if (
          f.assignedBiller &&
          !ciContains(null, f.assignedBiller) &&
          !["unassigned", "—", "-"].includes(f.assignedBiller.trim().toLowerCase())
        ) {
          continue;
        }

        rows.push({
          id: `${claimId}:${finding.ruleId}`,
          claimId,
          claimNumber: text(c.claim_number) || null,
          clientId,
          clientName,
          payerId,
          payerName,
          clinicianName,
          practiceName,
          dos,
          totalCharge: Number(c.total_charge ?? 0),
          ruleId: finding.ruleId,
          tab: meta.tab,
          errorType: meta.errorType,
          missingField: meta.missingField,
          fieldLocation: meta.fieldLocation,
          severity: finding.severity,
          assignedTo: null,
          lastAttemptedBuild:
            text(c.last_validated_at) || text(c.updated_at) || null,
          status,
          fixRoute: finding.fixRoute,
          whyItMatters: finding.whyItMatters,
          resolution: finding.message,
          agingDays: aging,
          followUpDue: deferUntil,
        });
      }
    }

    return NextResponse.json({
      success: true,
      items: rows,
      meta: {
        scanned: claims.length,
        sentinels: {
          buildHoldDeferUntil: BUILD_HOLD_DEFER_UNTIL,
          deferredReasonHold: DEFERRED_REASON_HOLD,
          deferredReasonRouted: DEFERRED_REASON_ROUTED,
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load claim build errors",
      },
      { status: 500 },
    );
  }
}
