/**
 * GET /api/billing/ready-to-generate/[claimId]/preview?organizationId=...
 *
 * Returns a human-readable claim preview for a single professional claim.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (value: unknown) => String(value ?? "").trim();
const yyyymmdd = (value: unknown) => text(value).replace(/-/g, "").slice(0, 8);
const yn = (value: unknown) => (value ? "YES" : "NO");

export async function GET(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: claim, error: claimError } = await (supabase as any)
      .from("professional_claims")
      .select("id, claim_number, patient_account_number, total_charge, place_of_service, diagnosis_codes, claim_status, accept_assignment")
      .eq("organization_id", organizationId)
      .eq("id", claimId)
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }

    const [{ data: lines }, { data: snapshot }] = await Promise.all([
      (supabase as any)
        .from("professional_claim_service_lines")
        .select("line_number, procedure_code, modifiers, charge_amount, units, service_date_from, place_of_service, diagnosis_pointers, rendering_provider_npi")
        .eq("claim_id", claimId)
        .order("line_number", { ascending: true }),
      (supabase as any)
        .from("claim_parties_snapshot")
        .select(
          "billing_provider_name, billing_provider_npi, billing_provider_tax_id, billing_provider_phone, billing_provider_address1, billing_provider_address2, billing_provider_city, billing_provider_state, billing_provider_zip, subscriber_first_name, subscriber_last_name, subscriber_member_id, subscriber_address1, subscriber_address2, subscriber_city, subscriber_state, subscriber_zip, insured_group_or_feca_number, patient_first_name, patient_last_name, patient_dob, patient_gender, patient_address1, patient_city, patient_state, patient_zip, patient_relationship_to_insured, payer_name, payer_id, condition_employment_related, condition_auto_accident_related, condition_auto_accident_state, condition_other_accident_related, rendering_provider_npi",
        )
        .eq("claim_id", claimId)
        .maybeSingle(),
    ]);

    const segments: string[] = [];
    const ref = text(claim.patient_account_number) || text(claim.claim_number) || text(claim.id);
    const pos = text(claim.place_of_service) || "11";

    if (snapshot) {
      segments.push(`CMS1500 BOX 1: Payer ${text(snapshot.payer_name)} (${text(snapshot.payer_id)})`);
      segments.push(`CMS1500 BOX 1A: Insured ID ${text(snapshot.subscriber_member_id)}`);
      segments.push(`CMS1500 BOX 2: Patient ${text(snapshot.patient_last_name)}, ${text(snapshot.patient_first_name)}`);
      segments.push(`CMS1500 BOX 3: Patient DOB ${text(snapshot.patient_dob)} Sex ${text(snapshot.patient_gender) || "U"}`);
      segments.push(`CMS1500 BOX 5: Patient address ${text(snapshot.patient_address1)}, ${text(snapshot.patient_city)}, ${text(snapshot.patient_state)} ${text(snapshot.patient_zip)}`);
      segments.push(`CMS1500 BOX 6: Relationship ${text(snapshot.patient_relationship_to_insured) || "self"}`);
      segments.push(`CMS1500 BOX 7: Insured address ${text(snapshot.subscriber_address1)}${text(snapshot.subscriber_address2) ? ` ${text(snapshot.subscriber_address2)}` : ""}, ${text(snapshot.subscriber_city)}, ${text(snapshot.subscriber_state)} ${text(snapshot.subscriber_zip)}`);
      segments.push(`CMS1500 BOX 10A/10B/10C: Employment ${yn(snapshot.condition_employment_related)} / Auto ${yn(snapshot.condition_auto_accident_related)} ${text(snapshot.condition_auto_accident_state) || "N/A"} / Other ${yn(snapshot.condition_other_accident_related)}`);
      segments.push(`CMS1500 BOX 11: Group ${text(snapshot.insured_group_or_feca_number) || ""}`);
      segments.push(`CMS1500 BOX 24J: Rendering NPI ${text(snapshot.rendering_provider_npi) || ""}`);
      segments.push(`CMS1500 BOX 25: Tax ID ${text(snapshot.billing_provider_tax_id)}`);
      segments.push(`CMS1500 BOX 27: Accept assignment ${yn(claim.accept_assignment !== false)}`);
      segments.push(`CMS1500 BOX 33: ${text(snapshot.billing_provider_name)} ${text(snapshot.billing_provider_phone)} ${text(snapshot.billing_provider_address1)}, ${text(snapshot.billing_provider_city)}, ${text(snapshot.billing_provider_state)} ${text(snapshot.billing_provider_zip)}`);
      segments.push("");
      segments.push(`NM1*85*2*${text(snapshot.billing_provider_name) || "BILLING PROVIDER"}*****XX*${text(snapshot.billing_provider_npi) || "?NPI?"}`);
      if (snapshot.billing_provider_tax_id) segments.push(`REF*EI*${text(snapshot.billing_provider_tax_id)}`);
      segments.push(`NM1*IL*1*${text(snapshot.subscriber_last_name) || "?"}*${text(snapshot.subscriber_first_name) || "?"}****MI*${text(snapshot.subscriber_member_id) || "?"}`);
      segments.push(`NM1*PR*2*${text(snapshot.payer_name) || "PAYER"}*****PI*${text(snapshot.payer_id) || "?"}`);
    } else {
      segments.push("(no claim_parties_snapshot — generate will fail until parties are populated)");
    }

    segments.push(`CLM*${ref}*${Number(claim.total_charge ?? 0).toFixed(2)}***${pos}:B:1*Y*A*Y*Y`);

    const dx = Array.isArray(claim.diagnosis_codes) ? (claim.diagnosis_codes as string[]) : [];
    if (dx.length > 0) {
      const hi = dx
        .slice(0, 12)
        .map((code, idx) => `${idx === 0 ? "ABK" : "ABF"}:${text(code)}`)
        .join("*");
      segments.push(`HI*${hi}`);
    }

    for (const line of (lines ?? []) as Record<string, unknown>[]) {
      const modifiers = Array.isArray(line.modifiers)
        ? (line.modifiers as unknown[]).map((m) => text(m)).filter(Boolean)
        : [];
      const pointers = Array.isArray(line.diagnosis_pointers)
        ? (line.diagnosis_pointers as unknown[]).map((p) => text(p)).filter(Boolean).join(",")
        : "1";
      const proc = `HC:${text(line.procedure_code) || "?"}${modifiers.length > 0 ? `:${modifiers.join(":")}` : ""}`;
      segments.push(`LX*${line.line_number ?? 1}`);
      segments.push(`SV1*${proc}*${Number(line.charge_amount ?? 0).toFixed(2)}*UN*${Number(line.units ?? 1)}*${text(line.place_of_service) || pos}*${pointers}***Y`);
      if (line.service_date_from) segments.push(`DTP*472*D8*${yyyymmdd(line.service_date_from)}`);
    }

    return NextResponse.json({
      success: true,
      claimId,
      preview: segments.join("\n"),
      lineCount: (lines ?? []).length,
    });
  } catch (error) {
    console.error("Ready-to-Generate preview error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 },
    );
  }
}
