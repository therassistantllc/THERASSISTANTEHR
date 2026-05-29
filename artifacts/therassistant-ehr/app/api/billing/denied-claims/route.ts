/**
 * GET /api/billing/denied-claims
 * Returns professional_claims where claim_status = 'denied',
 * joined with client, payer, appointment/provider data.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { getProviderIdForUser } from "@/lib/rbac/auth";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function isClinicianScoped(roles: string[]) {
  const hasClinician = roles.includes("clinician");
  const hasExpandedAccess = roles.some((r) => ["admin", "biller", "supervisor", "support"].includes(r));
  return hasClinician && !hasExpandedAccess;
}

function isMissingRpcError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "PGRST202";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const { organizationId } = guard;
    const practiceFilter = str(searchParams.get("practice"));
    const limitRaw = Number(searchParams.get("limit") ?? "100");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 250) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;
    const clinicianOnly = isClinicianScoped(guard.roles ?? []);
    const providerId = clinicianOnly && guard.userId
      ? await getProviderIdForUser(guard.userId, organizationId)
      : null;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase)
      return NextResponse.json({ success: false, error: "Database not available" }, { status: 500 });

    if (clinicianOnly && !providerId) {
      return NextResponse.json({
        success: true,
        clinicianOnly,
        canManage: false,
        practiceOptions: [],
        rows: [],
        total: 0,
        pagination: { limit, offset, returned: 0, totalCount: 0, hasMore: false },
      });
    }

    const { data, error } = await (supabase as any).rpc("billing_denied_claims_page_v2", {
      p_organization_id: organizationId,
      p_practice: practiceFilter || null,
      p_provider_id: clinicianOnly ? providerId : null,
      p_limit: limit,
      p_offset: offset,
    });

    let rpcRows = (data ?? []) as Array<Record<string, unknown>>;
    let totalCount = rpcRows.length > 0 ? Number(rpcRows[0].total_count ?? 0) : 0;

    if (error) {
      if (!isMissingRpcError(error)) throw error;

      console.warn("billing_denied_claims_page_v2 RPC not available; using fallback denied-claims query");
      const fallback = await (supabase as any)
        .from("professional_claims")
        .select(
          "id, claim_number, claim_status, total_charge, patient_responsibility_amount, payer_responsibility_amount, billing_notes, created_at, client_id, clients(first_name,last_name), payer_profiles(payer_name)",
          { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .eq("claim_status", "denied")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (fallback.error) throw fallback.error;

      totalCount = Number(fallback.count ?? 0);
      rpcRows = ((fallback.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const client = r.clients as Record<string, unknown> | null;
        const clientName = [str(client?.first_name), str(client?.last_name)].filter(Boolean).join(" ") || "—";
        const payer = r.payer_profiles as Record<string, unknown> | null;

        return {
          id: str(r.id),
          claim_number: str(r.claim_number),
          claim_status: str(r.claim_status),
          client_id: str(r.client_id),
          client_name: clientName,
          payer_name: str(payer?.payer_name) || "—",
          provider_name: null,
          date_of_service: null,
          total_charge: Number(r.total_charge ?? 0),
          patient_responsibility: Number(r.patient_responsibility_amount ?? 0),
          payer_paid: Number(r.payer_responsibility_amount ?? 0),
          cpt_code: "—",
          practice_id: null,
          denial_reason_code: null,
          denial_reason_description: null,
          appeal_deadline_date: null,
          correction_status: null,
          correction_type: null,
          billing_notes: str(r.billing_notes) || null,
          submitted_at: null,
          created_at: str(r.created_at),
          total_count: totalCount,
        };
      });
    }

    const practiceSet = new Set<string>();
    const rows = rpcRows.map((r) => {
      const practiceId = str(r.practice_id) || null;
      if (practiceId) practiceSet.add(practiceId);

      const totalCharge = Number(r.total_charge ?? 0);
      const patientResp = Number(r.patient_responsibility ?? 0);
      const payerPaid = Number(r.payer_paid ?? 0);
      const adjAmt = totalCharge - patientResp - payerPaid;

      return {
        id: str(r.id),
        claimId: str(r.id),
        claimNumber: str(r.claim_number),
        claimStatus: str(r.claim_status),
        clientId: str(r.client_id),
        clientName: str(r.client_name) || "—",
        payerName: str(r.payer_name) || "—",
        providerName: str(r.provider_name) || null,
        dateOfService: str(r.date_of_service) || null,
        totalCharge,
        allowedAmount: payerPaid + patientResp,
        adjustmentAmount: adjAmt,
        patientResponsibility: patientResp,
        payerPaid,
        amountPaid: 0,
        cptCode: str(r.cpt_code) || "—",
        practiceId,
        denialReasonCode: str(r.denial_reason_code) || null,
        denialReasonDescription: str(r.denial_reason_description) || null,
        appealDeadline: str(r.appeal_deadline_date) || null,
        correctionStatus: str(r.correction_status) || null,
        correctionType: str(r.correction_type) || null,
        billingNotes: str(r.billing_notes) || null,
        submittedAt: str(r.submitted_at) || null,
        createdAt: str(r.created_at),
      };
    });

    return NextResponse.json({
      success: true,
      clinicianOnly,
      canManage: !clinicianOnly,
      practiceOptions: Array.from(practiceSet).sort().map((p) => ({ value: p, label: p })),
      rows,
      total: rows.length,
      pagination: {
        limit,
        offset,
        returned: rows.length,
        totalCount,
        hasMore: offset + rows.length < totalCount,
      },
    });
  } catch (e) {
    console.error("Denied claims query failed", e);
    return NextResponse.json(
      { success: false, error: "Failed to load denied claims" },
      { status: 500 },
    );
  }
}
