/**
 * POST /api/billing/authorization-required/actions
 *
 * Single action endpoint for the Authorization Required workqueue.
 * Body: { organizationId, action, ...payload }
 *
 * Actions:
 *   - attach_auth      { claimId, authorizationNumber }
 *                      stamps professional_claims.prior_authorization_number
 *                      and clears the matching service-line authorization_number.
 *   - request_auth     { clientId, insurancePolicyId, serviceCode?, unitsAuthorized?, validFrom?, validTo?, authType? }
 *                      creates a new authorization_or_referrals row, status='pending'.
 *   - update_units     { authId, unitsAuthorized?, unitsUsed? }
 *   - hold_claim       { claimId, holdDays?, reason? }
 *                      sets professional_claims.defer_until (today + holdDays).
 *   - release_claim    { claimId }
 *                      clears defer_until / deferred_reason.
 *   - route_to_admin   { authId?, claimId?, note? }
 *                      writes a workqueue_items row (work_type='biller_review').
 *
 * Every action also writes one row to audit_logs.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, any>;

const text = (v: unknown) => String(v ?? "").trim();

interface ActionBody {
  organizationId?: string;
  action?: string;
  claimId?: string;
  authId?: string;
  authorizationNumber?: string;
  clientId?: string;
  insurancePolicyId?: string;
  serviceCode?: string;
  unitsAuthorized?: number | null;
  unitsUsed?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  authType?: "authorization" | "referral";
  holdDays?: number;
  reason?: string;
  note?: string;
}

async function writeAudit(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  args: {
    organizationId: string;
    userId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    summary: string;
    metadata: Record<string, unknown>;
    claimId?: string | null;
    patientId?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  if (!supabase) return;
  await (supabase as any).from("audit_logs").insert({
    organization_id: args.organizationId,
    user_id: args.userId,
    event_type: `authorization_required.${args.action}`,
    event_summary: args.summary,
    event_metadata: args.metadata,
    action: args.action,
    object_type: args.objectType,
    object_id: args.objectId,
    claim_id: args.claimId ?? null,
    patient_id: args.patientId ?? null,
    before_value: args.before == null ? null : args.before,
    after_value: args.after == null ? null : args.after,
  });
}

async function loadClaim(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  claimId: string,
): Promise<DbRow | null> {
  if (!supabase) return null;
  const { data } = await (supabase as any)
    .from("professional_claims")
    .select(
      "id, organization_id, patient_id, prior_authorization_number, defer_until, billing_notes",
    )
    .eq("organization_id", organizationId)
    .eq("id", claimId)
    .maybeSingle();
  return (data as DbRow) ?? null;
}

async function loadAuth(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  authId: string,
): Promise<DbRow | null> {
  if (!supabase) return null;
  const { data } = await (supabase as any)
    .from("authorization_or_referrals")
    .select(
      "id, organization_id, client_id, authorization_number, units_authorized, units_used, authorization_status",
    )
    .eq("organization_id", organizationId)
    .eq("id", authId)
    .maybeSingle();
  return (data as DbRow) ?? null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ActionBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const action = text(body.action);
    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    // ── attach_auth ───────────────────────────────────────────────────────
    if (action === "attach_auth") {
      const claimId = text(body.claimId);
      const authNumber = text(body.authorizationNumber);
      if (!claimId || !authNumber) {
        return NextResponse.json(
          { success: false, error: "claimId and authorizationNumber required" },
          { status: 400 },
        );
      }
      const claim = await loadClaim(supabase, organizationId, claimId);
      if (!claim) {
        return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
      }
      const before = { prior_authorization_number: claim.prior_authorization_number };
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ prior_authorization_number: authNumber })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      // Also stamp every service line on this claim so line-level auth
      // state matches the claim-level number we just set. Without this,
      // the wrong_service_code / wrong_provider tabs would keep
      // surfacing the same rows even after the user attached the auth.
      const { error: lineErr } = await (supabase as any)
        .from("professional_claim_service_lines")
        .update({ authorization_number: authNumber })
        .eq("claim_id", claimId);
      if (lineErr) throw lineErr;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "attach_auth",
        objectType: "professional_claim",
        objectId: claimId,
        claimId,
        patientId: text(claim.patient_id) || null,
        summary: `Attached authorization ${authNumber} to claim ${claimId.slice(0, 8)}`,
        metadata: { authorizationNumber: authNumber, serviceLinesStamped: true },
        before,
        after: { prior_authorization_number: authNumber },
      });
      return NextResponse.json({ success: true });
    }

    // ── request_auth ──────────────────────────────────────────────────────
    if (action === "request_auth") {
      const clientId = text(body.clientId);
      const policyId = text(body.insurancePolicyId);
      if (!clientId || !policyId) {
        return NextResponse.json(
          { success: false, error: "clientId and insurancePolicyId required" },
          { status: 400 },
        );
      }
      const insertRow = {
        organization_id: organizationId,
        client_id: clientId,
        insurance_policy_id: policyId,
        auth_type: body.authType === "referral" ? "referral" : "authorization",
        authorization_status: "pending",
        service_code: text(body.serviceCode) || null,
        units_authorized:
          body.unitsAuthorized == null ? null : Number(body.unitsAuthorized),
        valid_from: body.validFrom ?? null,
        valid_to: body.validTo ?? null,
        requested_at: new Date().toISOString(),
        created_by_user_id: userId,
      };
      const { data, error } = await (supabase as any)
        .from("authorization_or_referrals")
        .insert(insertRow)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      const newId = text((data as DbRow | null)?.id);
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "request_auth",
        objectType: "authorization_or_referral",
        objectId: newId || null,
        patientId: clientId,
        summary: `Requested authorization for client ${clientId.slice(0, 8)}`,
        metadata: { insurancePolicyId: policyId, serviceCode: insertRow.service_code },
        after: insertRow,
      });
      return NextResponse.json({ success: true, authId: newId });
    }

    // ── update_units ──────────────────────────────────────────────────────
    if (action === "update_units") {
      const authId = text(body.authId);
      if (!authId) {
        return NextResponse.json(
          { success: false, error: "authId required" },
          { status: 400 },
        );
      }
      const auth = await loadAuth(supabase, organizationId, authId);
      if (!auth) {
        return NextResponse.json({ success: false, error: "Auth not found" }, { status: 404 });
      }
      const patch: DbRow = { updated_by_user_id: userId };
      if (body.unitsAuthorized != null) patch.units_authorized = Number(body.unitsAuthorized);
      if (body.unitsUsed != null) patch.units_used = Number(body.unitsUsed);
      if (Object.keys(patch).length === 1) {
        return NextResponse.json(
          { success: false, error: "Nothing to update" },
          { status: 400 },
        );
      }
      const before = { units_authorized: auth.units_authorized, units_used: auth.units_used };
      const { error } = await (supabase as any)
        .from("authorization_or_referrals")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", authId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "update_units",
        objectType: "authorization_or_referral",
        objectId: authId,
        patientId: text(auth.client_id) || null,
        summary: `Updated authorization units for ${text(auth.authorization_number) || authId.slice(0, 8)}`,
        metadata: patch,
        before,
        after: patch,
      });
      return NextResponse.json({ success: true });
    }

    // ── hold_claim ────────────────────────────────────────────────────────
    if (action === "hold_claim") {
      const claimId = text(body.claimId);
      if (!claimId) {
        return NextResponse.json(
          { success: false, error: "claimId required" },
          { status: 400 },
        );
      }
      const claim = await loadClaim(supabase, organizationId, claimId);
      if (!claim) {
        return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
      }
      const days = Number(body.holdDays ?? 7);
      const holdDays = Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 7;
      const until = new Date(Date.now() + holdDays * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const reason = text(body.reason) || "Authorization follow-up";
      const before = { defer_until: claim.defer_until };
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ defer_until: until, deferred_reason: reason })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "hold_claim",
        objectType: "professional_claim",
        objectId: claimId,
        claimId,
        patientId: text(claim.patient_id) || null,
        summary: `Held claim ${claimId.slice(0, 8)} until ${until}`,
        metadata: { holdDays, reason, until },
        before,
        after: { defer_until: until, deferred_reason: reason },
      });
      return NextResponse.json({ success: true, until });
    }

    // ── release_claim ─────────────────────────────────────────────────────
    if (action === "release_claim") {
      const claimId = text(body.claimId);
      if (!claimId) {
        return NextResponse.json(
          { success: false, error: "claimId required" },
          { status: 400 },
        );
      }
      const claim = await loadClaim(supabase, organizationId, claimId);
      if (!claim) {
        return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
      }
      const before = { defer_until: claim.defer_until };
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ defer_until: null, deferred_reason: null })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "release_claim",
        objectType: "professional_claim",
        objectId: claimId,
        claimId,
        patientId: text(claim.patient_id) || null,
        summary: `Released claim ${claimId.slice(0, 8)}`,
        metadata: {},
        before,
        after: { defer_until: null },
      });
      return NextResponse.json({ success: true });
    }

    // ── route_to_admin ────────────────────────────────────────────────────
    if (action === "route_to_admin") {
      const claimId = text(body.claimId) || null;
      const authId = text(body.authId) || null;
      if (!claimId && !authId) {
        return NextResponse.json(
          { success: false, error: "claimId or authId required" },
          { status: 400 },
        );
      }
      let clientId: string | null = null;
      if (authId) {
        const auth = await loadAuth(supabase, organizationId, authId);
        if (!auth) {
          return NextResponse.json({ success: false, error: "Auth not found" }, { status: 404 });
        }
        clientId = text(auth.client_id) || null;
      } else if (claimId) {
        const claim = await loadClaim(supabase, organizationId, claimId);
        if (!claim) {
          return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
        }
        clientId = text(claim.patient_id) || null;
      }
      const sourceType = authId ? "authorization_or_referral" : "claim";
      const sourceId = authId ?? claimId!;
      const noteText = text(body.note) || "Routed from Authorization Required workqueue";
      const { data, error } = await (supabase as any)
        .from("workqueue_items")
        .insert({
          organization_id: organizationId,
          source_object_type: sourceType,
          source_object_id: sourceId,
          client_id: clientId,
          claim_id: claimId,
          priority: "high",
          status: "open",
          work_type: "biller_review",
          title: "Authorization issue — admin review",
          description: noteText,
          context_payload: { from: "authorization_required", authId, claimId },
          created_by_user_id: userId,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      const wqId = text((data as DbRow | null)?.id);
      await writeAudit(supabase, {
        organizationId,
        userId,
        action: "route_to_admin",
        objectType: sourceType,
        objectId: sourceId,
        claimId,
        patientId: clientId,
        summary: `Routed ${sourceType} ${sourceId.slice(0, 8)} to admin`,
        metadata: { workqueueItemId: wqId, note: noteText },
      });
      return NextResponse.json({ success: true, workqueueItemId: wqId });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    console.error("Authorization-required actions error:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
