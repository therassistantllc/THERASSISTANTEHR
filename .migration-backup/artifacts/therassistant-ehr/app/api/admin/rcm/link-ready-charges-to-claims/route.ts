import { NextResponse } from "next/server";
import { createClaimDraftFromChargeCapture } from "@/lib/claims/chargeCaptureClaimBridgeService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type RepairBody = {
  organizationId?: string;
  limit?: number;
  dryRun?: boolean;
};

type RepairResult = {
  chargeId: string;
  action: "would_link" | "linked" | "skipped" | "error";
  claimId: string | null;
  chargeStatus: string | null;
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

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as RepairBody | null;
    const organizationId = text(body?.organizationId);
    const limit = positiveLimit(body?.limit);
    const dryRun = body?.dryRun === true;

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const { data: charges, error: chargeError } = await supabase
      .from("charge_capture_items")
      .select("id, charge_status, claim_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("charge_status", "ready_for_claim")
      .is("claim_id", null)
      .order("service_date", { ascending: true })
      .limit(limit);

    if (chargeError) {
      return NextResponse.json({ success: false, error: chargeError.message }, { status: 500 });
    }

    const results: RepairResult[] = [];

    for (const charge of charges ?? []) {
      const chargeId = text((charge as Record<string, unknown>).id);
      const chargeStatus = text((charge as Record<string, unknown>).charge_status) || null;
      if (!chargeId) continue;

      if (dryRun) {
        results.push({
          chargeId,
          action: "would_link",
          claimId: null,
          chargeStatus,
          errors: [],
        });
        continue;
      }

      try {
        const claimDraft = await createClaimDraftFromChargeCapture({
          organizationId,
          chargeCaptureId: chargeId,
        });

        results.push({
          chargeId,
          action: claimDraft.ok && claimDraft.claimId ? "linked" : "error",
          claimId: claimDraft.claimId,
          chargeStatus,
          errors: claimDraft.errors ?? [],
        });
      } catch (error) {
        results.push({
          chargeId,
          action: "error",
          claimId: null,
          chargeStatus,
          errors: [{ field: "exception", message: error instanceof Error ? error.message : "Unknown charge claim repair error" }],
        });
      }
    }

    const summary = {
      scanned: results.length,
      wouldLink: results.filter((row) => row.action === "would_link").length,
      linked: results.filter((row) => row.action === "linked").length,
      errors: results.filter((row) => row.action === "error" || row.errors.length > 0).length,
    };

    return NextResponse.json({ success: true, dryRun, organizationId, limit, summary, results });
  } catch (error) {
    console.error("Ready charge claim linking repair failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Ready charge claim linking repair failed" },
      { status: 500 },
    );
  }
}
