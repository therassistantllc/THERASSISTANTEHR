import { NextResponse } from "next/server";
import { generate837PBatch } from "@/lib/claims/edi837pBatchService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  assertClaimReadyForSubmission,
  assertClaimSubmissionReady,
  gateResponse,
} from "@/lib/validation/claimSubmissionGate";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const organizationId = String(body.organizationId);

    // 1. System-readiness gate (always runs).
    const systemGate = await assertClaimSubmissionReady(organizationId);
    const systemBlocked = gateResponse(systemGate);
    if (systemBlocked) return systemBlocked;

    // 2. Per-claim content gate. If the caller didn't list claim IDs we look
    //    up every claim that the batch service would otherwise pick up so we
    //    can refuse to transmit any claim with blocking content findings.
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available." },
        { status: 503 },
      );
    }

    let claimIds: string[] = Array.isArray(body.claimIds) ? body.claimIds.map(String) : [];
    if (claimIds.length === 0) {
      const { data } = await supabase
        .from("professional_claims")
        .select("id")
        .eq("organization_id", organizationId)
        .in("claim_status", ["ready", "queued", "rejected"]);
      claimIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    }

    const perClaimBlocking: string[] = [];
    // Bounded-concurrency fan-out so large batches don't serialize end-to-end.
    const CONCURRENCY = 6;
    for (let i = 0; i < claimIds.length; i += CONCURRENCY) {
      const slice = claimIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (cid) => ({
          cid,
          gate: await assertClaimReadyForSubmission({ organizationId, claimId: cid }),
        })),
      );
      for (const { cid, gate: g } of results) {
        if (g.ok) continue;
        // Surface infrastructure failures with their original status so we
        // don't masquerade an outage as "content blocked".
        if (g.reason !== "blocking_findings") {
          const resp = gateResponse(g);
          if (resp) return resp;
        }
        perClaimBlocking.push(cid);
      }
    }

    if (perClaimBlocking.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Batch blocked: ${perClaimBlocking.length} claim(s) failed content validation.`,
          gate: {
            blocked: true,
            reason: "blocking_findings",
            scope: "claim_content",
            blockedClaimIds: perClaimBlocking,
            fixRoute: "/billing/claims",
          },
        },
        { status: 422 },
      );
    }

    const result = await generate837PBatch({
      organizationId,
      claimIds: Array.isArray(body.claimIds) ? body.claimIds.map(String) : undefined,
      mode: body.mode === "production" ? "production" : "test",
      fileName: body.fileName ?? null,
    });

    return NextResponse.json({ success: result.ok, result }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("837P batch API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "837P batch generation failed" },
      { status: 500 },
    );
  }
}
