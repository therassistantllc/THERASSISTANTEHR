/**
 * GET /api/billing/ready-to-generate/[claimId]/preview?organizationId=...
 *
 * Returns a human-readable "what the 837P will look like" preview for a
 * single claim. The biller uses this to spot-check loops/segments before
 * generating the actual batch file.
 *
 * The preview is intentionally a flattened summary (not a real X12 file).
 * Generating real X12 requires the full Availity connection + party
 * snapshots and lives in /api/claims/837p/batch/[id]/file. This endpoint
 * just sketches the headline segments so the right-side panel can show
 * something useful without a round-trip through the batch service.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (value: unknown) => String(value ?? "").trim();
const yyyymmdd = (value: unknown) => text(value).replace(/-/g, "").slice(0, 8);

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
      .select("id, claim_number, patient_account_number, total_charge, place_of_service, diagnosis_codes, claim_status")
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
        .select("line_number, procedure_code, modifiers, charge_amount, units, service_date_from, place_of_service")
        .eq("claim_id", claimId)
        .order("line_number", { ascending: true }),
      (supabase as any)
        .from("claim_parties_snapshot")
        .select(
          "billing_provider_name, billing_provider_npi, billing_provider_tax_id, subscriber_first_name, subscriber_last_name, subscriber_member_id, payer_name, payer_id",
        )
        .eq("claim_id", claimId)
        .maybeSingle(),
    ]);

    const segments: string[] = [];
    const ref = text(claim.patient_account_number) || text(claim.claim_number) || text(claim.id);
    const pos = text(claim.place_of_service) || "11";

    if (snapshot) {
      segments.push(
        `NM1*85*2*${text(snapshot.billing_provider_name) || "BILLING PROVIDER"}*****XX*${text(snapshot.billing_provider_npi) || "?NPI?"}`,
      );
      if (snapshot.billing_provider_tax_id) {
        segments.push(`REF*EI*${text(snapshot.billing_provider_tax_id)}`);
      }
      segments.push(
        `NM1*IL*1*${text(snapshot.subscriber_last_name) || "?"}*${text(snapshot.subscriber_first_name) || "?"}****MI*${text(snapshot.subscriber_member_id) || "?"}`,
      );
      segments.push(
        `NM1*PR*2*${text(snapshot.payer_name) || "PAYER"}*****PI*${text(snapshot.payer_id) || "?"}`,
      );
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
      const proc = `HC:${text(line.procedure_code) || "?"}${modifiers.length > 0 ? `:${modifiers.join(":")}` : ""}`;
      segments.push(`LX*${line.line_number ?? 1}`);
      segments.push(
        `SV1*${proc}*${Number(line.charge_amount ?? 0).toFixed(2)}*UN*${Number(line.units ?? 1)}*${text(line.place_of_service) || pos}****Y`,
      );
      if (line.service_date_from) {
        segments.push(`DTP*472*D8*${yyyymmdd(line.service_date_from)}`);
      }
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
