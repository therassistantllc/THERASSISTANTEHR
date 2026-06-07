import { NextResponse } from "next/server";
import { captureSignedEncounterCharge } from "@/lib/charges/signedEncounterChargeCaptureService";
import { createClaimDraftFromChargeCapture } from "@/lib/claims/chargeCaptureClaimBridgeService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type BackfillBody = {
  organizationId?: string;
  limit?: number;
  dryRun?: boolean;
};

type BackfillResult = {
  encounterId: string;
  action: "would_backfill" | "skipped_existing_charge" | "charge_created_or_refreshed" | "blocked" | "error";
  chargeId: string | null;
  chargeStatus: string | null;
  claimId: string | null;
  blockers: Array<{ field: string; message: string }>;
  errors: Array<{ field: string; message: string }>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveLimit(value: unknown) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.floor(parsed), 500);
}

function canCreateClaim(status: string | null | undefined) {
  return status === "ready_for_claim" || status === "claim_created";
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as BackfillBody | null;
    const organizationId = text(body?.organizationId);
    const limit = positiveLimit(body?.limit);
    const dryRun = body?.dryRun === true;

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const { data: encounters, error: encounterError } = await supabase
      .from("encounters")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("encounter_status", "signed")
      .is("archived_at", null)
      .order("service_date", { ascending: true })
      .limit(limit);

    if (encounterError) {
      return NextResponse.json({ success: false, error: encounterError.message }, { status: 500 });
    }

    const results: BackfillResult[] = [];

    for (const encounter of encounters ?? []) {
      const encounterId = text((encounter as Record<string, unknown>).id);
      if (!encounterId) continue;

      try {
        const { data: existingCharge, error: existingChargeError } = await supabase
          .from("charge_capture_items")
          .select("id, charge_status, claim_id")
          .eq("organization_id", organizationId)
          .eq("encounter_id", encounterId)
          .is("archived_at", null)
          .neq("charge_status", "voided")
          .limit(1)
          .maybeSingle();

        if (existingChargeError) throw new Error(existingChargeError.message);

        if (existingCharge?.id) {
          results.push({
            encounterId,
            action: "skipped_existing_charge",
            chargeId: text(existingCharge.id),
            chargeStatus: text(existingCharge.charge_status) || null,
            claimId: text(existingCharge.claim_id) || null,
            blockers: [],
            errors: [],
          });
          continue;
        }

        if (dryRun) {
          results.push({
            encounterId,
            action: "would_backfill",
            chargeId: null,
            chargeStatus: null,
            claimId: null,
            blockers: [],
            errors: [],
          });
          continue;
        }

        const chargeCapture = await captureSignedEncounterCharge({ organizationId, encounterId });
        let claimId: string | null = null;
        let errors: Array<{ field: string; message: string }> = [];

        if (chargeCapture.chargeId && canCreateClaim(chargeCapture.status)) {
          const claimDraft = await createClaimDraftFromChargeCapture({
            organizationId,
            chargeCaptureId: chargeCapture.chargeId,
          });
          claimId = claimDraft.claimId;
          errors = claimDraft.errors ?? [];
        }

        results.push({
          encounterId,
          action: chargeCapture.ok ? "charge_created_or_refreshed" : "blocked",
          chargeId: chargeCapture.chargeId,
          chargeStatus: chargeCapture.status,
          claimId,
          blockers: chargeCapture.blockers ?? [],
          errors,
        });
      } catch (error) {
        results.push({
          encounterId,
          action: "error",
          chargeId: null,
          chargeStatus: null,
          claimId: null,
          blockers: [],
          errors: [{ field: "exception", message: error instanceof Error ? error.message : "Unknown backfill error" }],
        });
      }
    }

    const summary = {
      scanned: results.length,
      wouldBackfill: results.filter((row) => row.action === "would_backfill").length,
      skippedExistingCharge: results.filter((row) => row.action === "skipped_existing_charge").length,
      chargeCreatedOrRefreshed: results.filter((row) => row.action === "charge_created_or_refreshed").length,
      blocked: results.filter((row) => row.action === "blocked").length,
      errors: results.filter((row) => row.action === "error" || row.errors.length > 0).length,
      claimsCreatedOrLinked: results.filter((row) => row.claimId).length,
    };

    return NextResponse.json({ success: true, dryRun, organizationId, limit, summary, results });
  } catch (error) {
    console.error("Signed encounter charge backfill failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Signed encounter charge backfill failed" },
      { status: 500 },
    );
  }
}
