import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { rebuild837PBatchFile } from "@/lib/claims/rebuild837PBatchFile";

export const runtime = "nodejs";

type JobRow = {
  id: string;
  organization_id: string;
  batch_id: string;
  attempt_count: number;
};

function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.INTERNAL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;

  const headerSecret = req.headers.get("x-cron-secret") || "";
  if (headerSecret && headerSecret === cronSecret) return true;

  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim() === cronSecret;
  }

  return false;
}

function parseLimit(raw: string | null): number {
  const n = Number(raw ?? "10");
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(Math.trunc(n), 1), 50);
}

export async function POST(req: NextRequest) {
  try {
    if (!isCronAuthorized(req)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 503 });
    }

    const { searchParams } = req.nextUrl;
    const limit = parseLimit(searchParams.get("limit"));

    const { data: pendingRows, error: pendingError } = await supabase
      .from("claim_837p_batch_generation_jobs")
      .select("id, organization_id, batch_id, attempt_count")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(limit);

    if (pendingError) throw pendingError;

    let claimed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const row of (pendingRows ?? []) as JobRow[]) {
      const startedAt = new Date().toISOString();
      const nextAttempt = Number(row.attempt_count ?? 0) + 1;

      const { data: claimedJob, error: claimError } = await supabase
        .from("claim_837p_batch_generation_jobs")
        .update({
          status: "running",
          started_at: startedAt,
          attempt_count: nextAttempt,
          updated_at: startedAt,
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id, organization_id, batch_id")
        .maybeSingle();

      if (claimError) throw claimError;
      if (!claimedJob) continue;
      claimed += 1;

      try {
        const result = await rebuild837PBatchFile({
          batchId: String((claimedJob as Record<string, unknown>).batch_id),
          organizationId: String((claimedJob as Record<string, unknown>).organization_id),
        });

        if (!result.ok) {
          throw new Error(result.error ?? "Batch generation failed");
        }

        const finishedAt = new Date().toISOString();
        const { error: successError } = await supabase
          .from("claim_837p_batch_generation_jobs")
          .update({
            status: "succeeded",
            finished_at: finishedAt,
            updated_at: finishedAt,
            last_error: null,
          })
          .eq("id", row.id)
          .eq("status", "running");

        if (successError) throw successError;
        succeeded += 1;
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const message = err instanceof Error ? err.message : String(err);

        await supabase
          .from("claim_837p_batch_generation_jobs")
          .update({
            status: "failed",
            finished_at: finishedAt,
            updated_at: finishedAt,
            last_error: message.slice(0, 2000),
          })
          .eq("id", row.id)
          .eq("status", "running");

        failed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      scanned: (pendingRows ?? []).length,
      claimed,
      succeeded,
      failed,
    });
  } catch (error) {
    console.error("837 queue processor failed", error);
    return NextResponse.json(
      { success: false, error: "Queue processing failed" },
      { status: 500 },
    );
  }
}
