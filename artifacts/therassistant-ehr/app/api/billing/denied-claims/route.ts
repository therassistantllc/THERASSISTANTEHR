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
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isClinicianScoped(roles: string[]) {
  const hasClinician = roles.includes("clinician");
  const hasExpandedAccess = roles.some((r) => ["admin", "biller", "supervisor", "support"].includes(r));
  return hasClinician && !hasExpandedAccess;
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

    let clinicianAppointmentIds: string[] | null = null;
    if (clinicianOnly) {
      if (!providerId) {
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

      const { data: providerAppts, error: providerApptsError } = await supabase
        .from("appointments")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider_id", providerId)
        .is("archived_at", null);
      if (providerApptsError) throw providerApptsError;
      clinicianAppointmentIds = (providerAppts ?? [])
        .map((row) => str((row as Record<string, unknown>).id))
        .filter(Boolean);

      if (clinicianAppointmentIds.length === 0) {
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
    }

    let query = supabase
      .from("professional_claims")
      .select(
        `id, claim_number, claim_status, total_charge, patient_responsibility_amount,
         payer_responsibility_amount, denial_reason_code, denial_reason_description,
         first_billed_date, submitted_at, appeal_deadline_date, billing_notes,
         diagnosis_codes, place_of_service, prior_authorization_number,
         correction_status, correction_type, client_id, payer_profile_id, appointment_id,
         created_at, updated_at,
         clients(id, first_name, last_name, email),
         payer_profiles(payer_name),
         appointments!inner(id, scheduled_start_at, provider_id, provider_location_id,
                      providers(id, first_name, last_name, display_name))`,
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("claim_status", "denied")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (clinicianAppointmentIds && clinicianAppointmentIds.length > 0) {
      query = query.in("appointment_id", clinicianAppointmentIds);
    }
    if (practiceFilter) {
      query = query.eq("appointments.provider_location_id", practiceFilter);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const appointmentIds = (data ?? []).map((r) => str(r.appointment_id)).filter(Boolean);

    const { data: serviceLineRows } = appointmentIds.length
      ? await supabase
          .from("professional_claim_service_lines")
          .select("claim_id, procedure_code")
          .eq("organization_id", organizationId)
          .in("claim_id", (data ?? []).map((r) => str(r.id)).filter(Boolean))
          .is("archived_at", null)
      : { data: [] as Array<Record<string, unknown>> };

    const procedureByClaimId = new Map<string, string>();
    for (const line of (serviceLineRows ?? []) as Array<Record<string, unknown>>) {
      const claimId = str(line.claim_id);
      if (!claimId || procedureByClaimId.has(claimId)) continue;
      procedureByClaimId.set(claimId, str(line.procedure_code) || "—");
    }

    const practiceSet = new Set<string>();

    const rows = (data ?? []).flatMap((r) => {
      const client = r.clients as unknown as Record<string, unknown> | null;
      const payer = r.payer_profiles as unknown as Record<string, unknown> | null;
      const appt = r.appointments as unknown as Record<string, unknown> | null;
      const provider = appt?.providers as Record<string, unknown> | null;
      const claimProviderId = str(appt?.provider_id);
      const practiceId = str(appt?.provider_location_id) || null;
      if (practiceId) practiceSet.add(practiceId);
      if (clinicianOnly && providerId && claimProviderId !== providerId) return [];
      if (practiceFilter && practiceId !== practiceFilter) return [];

      const providerName =
        str(provider?.display_name) ||
        [str(provider?.first_name), str(provider?.last_name)].filter(Boolean).join(" ") ||
        null;
      const totalCharge = num(r.total_charge);
      const patientResp = num(r.patient_responsibility_amount);
      const payerPaid = num(r.payer_responsibility_amount);
      const adjAmt = totalCharge - patientResp - payerPaid;

      return [{
        id: str(r.id),
        claimId: str(r.id),
        claimNumber: str(r.claim_number),
        claimStatus: str(r.claim_status),
        clientId: str(client?.id ?? r.client_id),
        clientName: client
          ? [str(client.first_name), str(client.last_name)].filter(Boolean).join(" ")
          : "—",
        payerName: str(payer?.payer_name) || "—",
        providerName,
        dateOfService: appt?.scheduled_start_at
          ? new Date(str(appt.scheduled_start_at)).toISOString().split("T")[0]
          : str(r.first_billed_date) || null,
        totalCharge,
        allowedAmount: payerPaid + patientResp,
        adjustmentAmount: adjAmt,
        patientResponsibility: patientResp,
        payerPaid,
        amountPaid: 0,
        cptCode: procedureByClaimId.get(str(r.id)) ?? "—",
        practiceId,
        denialReasonCode: str(r.denial_reason_code) || null,
        denialReasonDescription: str(r.denial_reason_description) || null,
        appealDeadline: str(r.appeal_deadline_date) || null,
        correctionStatus: str(r.correction_status) || null,
        correctionType: str(r.correction_type) || null,
        billingNotes: str(r.billing_notes) || null,
        submittedAt: str(r.submitted_at) || null,
        createdAt: str(r.created_at),
      }];
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
        totalCount: count ?? null,
        hasMore: count != null ? offset + rows.length < count : rows.length === limit,
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
