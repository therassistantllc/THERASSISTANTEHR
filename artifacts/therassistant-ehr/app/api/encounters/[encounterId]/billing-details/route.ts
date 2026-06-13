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
    return {
      success: false,
      error: text(record.message) || fallback,
      code: text(record.code) || null,
      details: text(record.details) || null,
      hint: text(record.hint) || null,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

function splitProviderName(providerName: string) {
  const parts = providerName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Provider";
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

async function resolveEncounterRenderingCredentialingProfileId(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  appointmentId: unknown;
  providerId: unknown;
}) {
  const { supabase, organizationId, appointmentId, providerId } = params;
  const appointmentIdText = text(appointmentId);
  const providerIdText = text(providerId);

  if (appointmentIdText) {
    const { data: appointment, error } = await supabase
      .from("appointments")
      .select("provider_credentialing_profile_id, provider_id")
      .eq("organization_id", organizationId)
      .eq("id", appointmentIdText)
      .is("archived_at", null)
      .maybeSingle();

    if (error) throw error;

    const appointmentProfileId = text(appointment?.provider_credentialing_profile_id);
    if (appointmentProfileId) return appointmentProfileId;

    const appointmentProviderId = text(appointment?.provider_id);
    if (appointmentProviderId) return appointmentProviderId;
  }

  if (!providerIdText) return null;

  const { data: profileById, error: profileError } = await supabase
    .from("provider_credentialing_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", providerIdText)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profileById?.id) return String(profileById.id);

  return null;
}

async function ensureRosterProviderIdForCredentialingProfile(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  credentialingProfileId: string | null;
}) {
  const { supabase, organizationId, credentialingProfileId } = params;
  const profileId = text(credentialingProfileId);
  if (!profileId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("provider_credentialing_profiles")
    .select("id, provider_name, credential_display, individual_npi, taxonomy_code, individual_medicaid_id, email, phone")
    .eq("organization_id", organizationId)
    .eq("id", profileId)
    .is("archived_at", null)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const npi = text(profile.individual_npi);
  const email = text(profile.email);
  const displayName = text(profile.provider_name) || "Provider";

  if (npi) {
    const { data } = await supabase
      .from("providers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("npi", npi)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  if (email) {
    const { data } = await supabase
      .from("providers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  if (displayName) {
    const { data } = await supabase
      .from("providers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("display_name", displayName)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const { firstName, lastName } = splitProviderName(displayName);
  const { data: inserted, error: insertError } = await supabase
    .from("providers")
    .insert({
      organization_id: organizationId,
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      email: email || null,
      phone: text(profile.phone) || null,
      credential: text(profile.credential_display) || null,
      npi: npi || null,
      taxonomy_code: text(profile.taxonomy_code) || null,
      medicaid_id: text(profile.individual_medicaid_id) || null,
      provider_type: "clinician",
      can_bill_independently: true,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return inserted?.id ? String(inserted.id) : null;
}

export async function GET(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { encounterId } = await context.params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const { data: encounter, error: encounterError } = await supabase
      .from("encounters")
      .select(
        "id, client_id, provider_id, appointment_id, encounter_status, service_date, started_at, ended_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", encounterId)
      .is("archived_at", null)
      .maybeSingle();

    if (encounterError) throw encounterError;

    if (!encounter) {
      return NextResponse.json({ success: false, error: "Encounter not found" }, { status: 404 });
    }

    const { data: diagnoses, error: diagnosesError } = await supabase
      .from("encounter_diagnoses")
      .select("id, diagnosis_code, diagnosis_description, is_primary, sequence_number, present_on_claim")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .order("sequence_number", { ascending: true });

    if (diagnosesError) throw diagnosesError;

    const { data: serviceLines, error: serviceLinesError } = await supabase
      .from("encounter_service_lines")
      .select(
        "id, service_date, sequence_number, cpt_hcpcs_code, modifier_1, modifier_2, modifier_3, modifier_4, units, charge_amount, place_of_service_code, rendering_provider_id, rendering_provider_credentialing_profile_id",
      )
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .order("sequence_number", { ascending: true });

    if (serviceLinesError) throw serviceLinesError;

    return NextResponse.json({
      success: true,
      organizationId,
      encounter,
      diagnoses: diagnoses ?? [],
      serviceLines: serviceLines ?? [],
    });
  } catch (error) {
    console.error("Encounter billing details GET error:", error);
    return NextResponse.json(errorPayload(error, "Encounter billing details failed"), { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { encounterId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Request body must be valid JSON" }, { status: 400 });
    }

    const organizationId = text(body.organizationId);
    const diagnoses = Array.isArray(body.diagnoses) ? (body.diagnoses as DiagnosisInput[]) : [];
    const serviceLines = Array.isArray(body.serviceLines) ? (body.serviceLines as ServiceLineInput[]) : [];

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const { data: encounter, error: encounterError } = await supabase
      .from("encounters")
      .select("id, client_id, provider_id, appointment_id, service_date, encounter_status")
      .eq("organization_id", organizationId)
      .eq("id", encounterId)
      .is("archived_at", null)
      .maybeSingle();

    if (encounterError) throw encounterError;

    if (!encounter) {
      return NextResponse.json({ success: false, error: "Encounter not found" }, { status: 404 });
    }

    const renderingCredentialingProfileId = await resolveEncounterRenderingCredentialingProfileId({
      supabase,
      organizationId,
      appointmentId: encounter.appointment_id,
      providerId: encounter.provider_id,
    });

    const renderingProviderId = await ensureRosterProviderIdForCredentialingProfile({
      supabase,
      organizationId,
      credentialingProfileId: renderingCredentialingProfileId,
    });

    if (!renderingProviderId) {
      return NextResponse.json(
        { success: false, error: "Rendering provider could not be resolved to a provider roster record." },
        { status: 422 },
      );
    }

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
        rendering_provider_id: renderingProviderId,
        rendering_provider_credentialing_profile_id: renderingCredentialingProfileId,
        created_at: now,
        updated_at: now,
      }))
      .filter((line) => line.cpt_hcpcs_code && line.charge_amount > 0 && line.service_date);

    const incomingDiagnosesProvided = diagnoses.length > 0;
    const incomingServiceLinesProvided = serviceLines.length > 0;

    if (incomingDiagnosesProvided && diagnosisPayload.length === 0) {
      return NextResponse.json(
        { success: false, error: "Refusing to save an empty or invalid diagnosis payload." },
        { status: 422 },
      );
    }

    if (incomingServiceLinesProvided && servicePayload.length === 0) {
      return NextResponse.json(
        { success: false, error: "Refusing to save an empty or invalid service line payload." },
        { status: 422 },
      );
    }

    const invalidPos = servicePayload.find((line) => {
      const pos = String(line.place_of_service_code ?? "").trim();
      return pos.length > 0 && !isAllowedPlaceOfService(pos);
    });

    if (invalidPos) {
      const warning =
        placeOfServiceWarning(invalidPos.place_of_service_code) ??
        `POS ${String(invalidPos.place_of_service_code ?? "").trim()} is not allowed. Use 11 (office) or 02 (telehealth).`;

      return NextResponse.json(
        {
          success: false,
          error: warning,
          errors: [{ field: "serviceLines.placeOfServiceCode", message: warning }],
        },
        { status: 422 },
      );
    }

    if (incomingDiagnosesProvided) {
      const { error: deleteDiagnosisError } = await supabase
        .from("encounter_diagnoses")
        .delete()
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId);

      if (deleteDiagnosisError) throw deleteDiagnosisError;

      if (diagnosisPayload.length > 0) {
        const { error: insertDiagnosisError } = await supabase.from("encounter_diagnoses").insert(diagnosisPayload);
        if (insertDiagnosisError) throw insertDiagnosisError;
      }
    }

    if (incomingServiceLinesProvided) {
      const { error: deleteServiceLineError } = await supabase
        .from("encounter_service_lines")
        .delete()
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId);

      if (deleteServiceLineError) throw deleteServiceLineError;

      if (servicePayload.length > 0) {
        const { error: insertServiceLineError } = await supabase.from("encounter_service_lines").insert(servicePayload);
        if (insertServiceLineError) throw insertServiceLineError;
      }
    }

    let chargeCapture = null;

    if (encounter.encounter_status === "signed") {
      chargeCapture = await captureSignedEncounterCharge({ organizationId, encounterId });
    }

    return NextResponse.json({
      success: true,
      encounterId,
      diagnosisCount: diagnosisPayload.length,
      serviceLineCount: servicePayload.length,
      chargeCapture,
    });
  } catch (error) {
    console.error("Encounter billing details POST error:", error);
    return NextResponse.json(errorPayload(error, "Encounter billing details save failed"), { status: 500 });
  }
}
