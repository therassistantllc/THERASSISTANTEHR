import { NextResponse } from "next/server";
import { isAllowedPlaceOfService, placeOfServiceWarning } from "@/lib/billing/placeOfService";
import { captureSignedEncounterCharge } from "@/lib/charges/signedEncounterChargeCaptureService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DiagnosisInput = {
  diagnosisCode?: string;
  diagnosisDescription?: string | null;
  isPrimary?: boolean;
  presentOnClaim?: boolean;
  diagnosis_code?: string;
  diagnosis_description?: string | null;
  is_primary?: boolean;
  present_on_claim?: boolean;
};

type ServiceLineInput = {
  serviceDate?: string;
  procedureCode?: string;
  modifier1?: string | null;
  modifier2?: string | null;
  modifier3?: string | null;
  modifier4?: string | null;
  units?: number;
  chargeAmount?: number;
  placeOfServiceCode?: string | null;
  service_date?: string;
  cpt_hcpcs_code?: string;
  modifier_1?: string | null;
  modifier_2?: string | null;
  modifier_3?: string | null;
  modifier_4?: string | null;
  charge_amount?: number;
  place_of_service_code?: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

function errorPayload(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = text(record.message) || fallback;
    return {
      success: false,
      error: message,
      code: text(record.code) || null,
      details: text(record.details) || null,
      hint: text(record.hint) || null,
    };
  }
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

export async function GET(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { encounterId } = await context.params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });

    const { data: encounter, error: encounterError } = await supabase
      .from("encounters")
      .select("id, client_id, provider_id, provider_credentialing_profile_id, appointment_id, encounter_status, service_date, started_at, ended_at")
      .eq("organization_id", organizationId)
      .eq("id", encounterId)
      .is("archived_at", null)
      .maybeSingle();

    if (encounterError || !encounter) return NextResponse.json({ success: false, error: "Encounter not found" }, { status: 404 });

    const { data: diagnoses } = await supabase
      .from("encounter_diagnoses")
      .select("id, diagnosis_code, diagnosis_description, is_primary, sequence_number, present_on_claim")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .order("sequence_number", { ascending: true });

    const { data: serviceLines } = await supabase
      .from("encounter_service_lines")
      .select("id, service_date, sequence_number, cpt_hcpcs_code, modifier_1, modifier_2, modifier_3, modifier_4, units, charge_amount, place_of_service_code, rendering_provider_id, rendering_provider_credentialing_profile_id")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .order("sequence_number", { ascending: true });

    return NextResponse.json({ success: true, organizationId, encounter, diagnoses: diagnoses ?? [], serviceLines: serviceLines ?? [] });
  } catch (error) {
    console.error("Encounter billing details GET error:", error);
    return NextResponse.json(errorPayload(error, "Encounter billing details failed"), { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { encounterId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ success: false, error: "Request body must be valid JSON" }, { status: 400 });

    const organizationId = text(body.organizationId);
    const diagnoses = Array.isArray(body.diagnoses) ? (body.diagnoses as DiagnosisInput[]) : [];
    const serviceLines = Array.isArray(body.serviceLines) ? (body.serviceLines as ServiceLineInput[]) : [];
    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });

    const { data: encounter, error: encounterError } = await supabase
      .from("encounters")
      .select("id, client_id, provider_id, provider_credentialing_profile_id, service_date, encounter_status")
      .eq("organization_id", organizationId)
      .eq("id", encounterId)
      .is("archived_at", null)
      .maybeSingle();

    if (encounterError || !encounter) return NextResponse.json({ success: false, error: "Encounter not found" }, { status: 404 });

    const now = new Date().toISOString();

    const diagnosisPayload = diagnoses
      .map((diagnosis, index) => ({
        organization_id: organizationId,
        encounter_id: encounterId,
        diagnosis_code: text(diagnosis.diagnosisCode ?? diagnosis.diagnosis_code).toUpperCase(),
        diagnosis_description: text(diagnosis.diagnosisDescription ?? diagnosis.diagnosis_description) || null,
        is_primary: diagnosis.isPrimary ?? diagnosis.is_primary ?? index === 0,
        sequence_number: index + 1,
        present_on_claim: diagnosis.presentOnClaim ?? diagnosis.present_on_claim ?? true,
        created_at: now,
        updated_at: now,
      }))
      .filter((diagnosis) => diagnosis.diagnosis_code);

    const servicePayload = serviceLines
      .map((line, index) => ({
        organization_id: organizationId,
        encounter_id: encounterId,
        service_date: text(line.serviceDate ?? line.service_date) || encounter.service_date,
        sequence_number: index + 1,
        cpt_hcpcs_code: text(line.procedureCode ?? line.cpt_hcpcs_code).toUpperCase(),
        modifier_1: text(line.modifier1 ?? line.modifier_1) || null,
        modifier_2: text(line.modifier2 ?? line.modifier_2) || null,
        modifier_3: text(line.modifier3 ?? line.modifier_3) || null,
        modifier_4: text(line.modifier4 ?? line.modifier_4) || null,
        units: Number(line.units ?? 1) || 1,
        charge_amount: money(line.chargeAmount ?? line.charge_amount),
        place_of_service_code: text(line.placeOfServiceCode ?? line.place_of_service_code) || null,
        rendering_provider_id: encounter.provider_id,
        rendering_provider_credentialing_profile_id: encounter.provider_credentialing_profile_id ?? null,
        created_at: now,
        updated_at: now,
      }))
      .filter((line) => line.cpt_hcpcs_code && line.charge_amount > 0 && line.service_date);

    const existingDiagnosisCount = await supabase
      .from("encounter_diagnoses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null);

    const existingServiceLineCount = await supabase
      .from("encounter_service_lines")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null);

    const incomingDiagnosesProvided = diagnoses.length > 0;
    const incomingServiceLinesProvided = serviceLines.length > 0;

    if (incomingDiagnosesProvided && diagnosisPayload.length === 0 && (existingDiagnosisCount.count ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "Refusing to replace existing diagnoses with an empty or invalid diagnosis payload." }, { status: 422 });
    }

    if (incomingServiceLinesProvided && servicePayload.length === 0 && (existingServiceLineCount.count ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "Refusing to replace existing service lines with an empty or invalid service line payload." }, { status: 422 });
    }

    const invalidPos = servicePayload.find((line) => {
      const pos = String(line.place_of_service_code ?? "").trim();
      return pos.length > 0 && !isAllowedPlaceOfService(pos);
    });
    if (invalidPos) {
      const warning = placeOfServiceWarning(invalidPos.place_of_service_code) ?? `POS ${String(invalidPos.place_of_service_code ?? "").trim()} is not allowed. Use 11 (office) or 02 (telehealth).`;
      return NextResponse.json({ success: false, error: warning, errors: [{ field: "serviceLines.placeOfServiceCode", message: warning }] }, { status: 422 });
    }

    if (incomingDiagnosesProvided) {
      const { error: archiveDiagnosisError } = await supabase
        .from("encounter_diagnoses")
        .update({ archived_at: now, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId)
        .is("archived_at", null);
      if (archiveDiagnosisError) throw archiveDiagnosisError;

      if (diagnosisPayload.length > 0) {
        const { error } = await supabase.from("encounter_diagnoses").insert(diagnosisPayload);
        if (error) throw error;
      }
    }

    if (incomingServiceLinesProvided) {
      const { error: archiveServiceLineError } = await supabase
        .from("encounter_service_lines")
        .update({ archived_at: now, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId)
        .is("archived_at", null);
      if (archiveServiceLineError) throw archiveServiceLineError;

      if (servicePayload.length > 0) {
        const { error } = await supabase.from("encounter_service_lines").insert(servicePayload);
        if (error) throw error;
      }
    }

    let chargeCapture = null;
    if (encounter.encounter_status === "signed") {
      // Keep the Claim Prep queue synchronized after billing edits, but do not
      // create/release the professional claim until the biller clicks Release
      // from Claim Prep.
      chargeCapture = await captureSignedEncounterCharge({ organizationId, encounterId });
    }

    return NextResponse.json({ success: true, encounterId, diagnosisCount: diagnosisPayload.length, serviceLineCount: servicePayload.length, chargeCapture });
  } catch (error) {
    console.error("Encounter billing details POST error:", error);
    return NextResponse.json(errorPayload(error, "Encounter billing details save failed"), { status: 500 });
  }
}