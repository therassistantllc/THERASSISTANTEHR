import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function notFound() {
  return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ encounterId: string }> },
) {
  if (process.env.NODE_ENV === "production") return notFound();

  const expected = process.env.E2E_CHECK_VALUE ?? "local-playwright-system-test";
  const received = request.headers.get("x-e2e-check") ?? "";
  if (!expected || received !== expected) return notFound();

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Database connection not available" },
      { status: 500 },
    );
  }

  const { encounterId } = await context.params;
  const { searchParams } = new URL(request.url);
  const organizationId = text(searchParams.get("organizationId"));

  if (!organizationId) {
    return NextResponse.json(
      { success: false, error: "organizationId is required" },
      { status: 400 },
    );
  }

  const { data: encounter, error: encounterError } = await supabase
    .from("encounters")
    .select("id, organization_id, client_id, provider_id, appointment_id, encounter_status, service_date, required_billing_fields_complete")
    .eq("organization_id", organizationId)
    .eq("id", encounterId)
    .is("archived_at", null)
    .maybeSingle();

  if (encounterError) {
    return NextResponse.json(
      { success: false, error: encounterError.message },
      { status: 500 },
    );
  }

  const { data: charge } = await supabase
    .from("charge_capture_items")
    .select("id, charge_status, claim_id, diagnosis_codes, service_lines, total_charge, blocker_reasons, encounter_id, client_id, provider_id, appointment_id, insurance_policy_id")
    .eq("organization_id", organizationId)
    .eq("encounter_id", encounterId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const chargeRow = (charge as DbRow | null) ?? null;
  const claimId = text(chargeRow?.claim_id);

  let claim: DbRow | null = null;
  if (claimId) {
    const { data } = await supabase
      .from("professional_claims")
      .select("id, claim_status, diagnosis_codes, total_charge, validation_errors, patient_id, client_id, encounter_id, appointment_id, place_of_service")
      .eq("organization_id", organizationId)
      .eq("id", claimId)
      .neq("claim_status", "voided")
      .maybeSingle();
    claim = (data as DbRow | null) ?? null;
  } else {
    const { data } = await supabase
      .from("professional_claims")
      .select("id, claim_status, diagnosis_codes, total_charge, validation_errors, patient_id, client_id, encounter_id, appointment_id, place_of_service")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .neq("claim_status", "voided")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    claim = (data as DbRow | null) ?? null;
  }

  let serviceLines: DbRow[] = [];
  if (claim?.id) {
    const { data } = await supabase
      .from("professional_claim_service_lines")
      .select("id, claim_id, line_number, procedure_code, service_date_from, charge_amount, units, diagnosis_pointers, place_of_service")
      .eq("claim_id", String(claim.id))
      .order("line_number", { ascending: true });
    serviceLines = (data ?? []) as DbRow[];
  }

  return NextResponse.json({
    success: true,
    snapshot: {
      encounter: (encounter as DbRow | null) ?? null,
      charge: chargeRow,
      claim,
      serviceLines,
    },
  });
}
