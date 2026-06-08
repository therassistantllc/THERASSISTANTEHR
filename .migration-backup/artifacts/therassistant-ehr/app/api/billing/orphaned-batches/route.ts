/**
 * GET /api/billing/orphaned-batches  (Task #694)
 *
 * Lists every 837P batch stuck in `ready_to_generate` that has a
 * persisted `last_generation_error` — i.e. the biller clicked Generate
 * or Bulk Batch, the 837P validator rejected the build, and the batch
 * is now silently sitting at `ready_to_generate` with no transmission
 * row for the Transmission Failures workqueue to pick up.
 *
 * The row carries:
 *   - the persisted validator error + structured pointer (loop / segment / field / claimId)
 *   - the originating biller (created_by_user_id) when known, so the
 *     UI's "Routed to me" filter can narrow the queue to the biller
 *     who triggered the failed generate
 *   - the per-claim summary (number, client, payer, total) so the
 *     biller can decide whether to retry, edit a claim, or break up
 *     the batch
 *
 * Query params:
 *   organizationId  (verified against the session by requireBillingAccess)
 *   assignedBiller  (optional) — userId of the originating biller, or
 *                   the sentinel "__me__" / "__unassigned__"
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const MAX_BATCHES = 200;

type DbRow = Record<string, unknown>;

interface ClaimSummary {
  id: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  totalCharge: number;
  status: string;
}

interface OrphanedBatchRow {
  id: string;
  batchNumber: string;
  batchStatus: string;
  claimCount: number;
  totalCharges: number;
  errorMessage: string;
  errorDetail: {
    code?: string;
    message?: string;
    claimId?: string;
    loop?: string;
    segment?: string;
    field?: string;
  } | null;
  attemptedAt: string | null;
  agingDays: number | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  claims: ClaimSummary[];
}

interface Biller {
  id: string;
  displayName: string;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: url.searchParams.get("organizationId"),
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

    const assignedBillerRaw = url.searchParams.get("assignedBiller") ?? "";
    const assignedBiller =
      assignedBillerRaw === "__me__" ? guard.userId ?? "__unassigned__" : assignedBillerRaw;

    // Pull the orphaned batches. Partial index
    // `claim_837p_batches_orphaned_idx` keeps this cheap.
    let q = (supabase as any)
      .from("claim_837p_batches")
      .select(
        "id, batch_number, batch_status, claim_count, total_charge_amount, " +
          "last_generation_error, last_generation_error_detail, " +
          "last_generation_attempted_at, created_at, updated_at, " +
          "created_by_user_id, created_by_display_name",
      )
      .eq("organization_id", organizationId)
      .eq("batch_status", "ready_to_generate")
      .not("last_generation_error", "is", null)
      .order("last_generation_attempted_at", { ascending: false, nullsFirst: false })
      .limit(MAX_BATCHES);

    if (assignedBiller === "__unassigned__") {
      q = q.is("created_by_user_id", null);
    } else if (assignedBiller) {
      q = q.eq("created_by_user_id", assignedBiller);
    }

    const { data: batchRows, error: batchErr } = await q;
    if (batchErr) throw batchErr;

    const batches = (batchRows ?? []) as DbRow[];
    const batchIds = batches.map((b) => text(b.id));

    // ── Per-batch claim summary (one query for all batches) ─────────────────
    type LinkRow = { batch_id: string; professional_claim_id: string };
    let claimsByBatch = new Map<string, ClaimSummary[]>();
    const allClaimIds: string[] = [];
    const claimToBatch = new Map<string, string>();
    if (batchIds.length > 0) {
      const { data: linkRows, error: linkErr } = await (supabase as any)
        .from("claim_837p_batch_claims")
        .select("batch_id, professional_claim_id")
        .in("batch_id", batchIds)
        .eq("organization_id", organizationId)
        .is("archived_at", null);
      if (linkErr) throw linkErr;
      for (const row of ((linkRows ?? []) as LinkRow[])) {
        const bid = String(row.batch_id);
        const cid = String(row.professional_claim_id);
        claimToBatch.set(cid, bid);
        allClaimIds.push(cid);
      }
    }

    let claimSummaries = new Map<string, ClaimSummary>();
    if (allClaimIds.length > 0) {
      const { data: claimRows, error: claimErr } = await (supabase as any)
        .from("professional_claims")
        .select(
          "id, claim_number, claim_status, total_charge, client_id, payer_profile_id, " +
            "clients:client_id(first_name, last_name), " +
            "payer_profiles:payer_profile_id(payer_name)",
        )
        .in("id", allClaimIds)
        .eq("organization_id", organizationId);
      if (claimErr) throw claimErr;
      for (const row of ((claimRows ?? []) as DbRow[])) {
        const id = text(row.id);
        const client = (row.clients ?? null) as { first_name?: string; last_name?: string } | null;
        const payer = (row.payer_profiles ?? null) as { payer_name?: string } | null;
        const clientName =
          [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim() || "(unknown)";
        claimSummaries.set(id, {
          id,
          claimNumber: text(row.claim_number) || null,
          clientId: text(row.client_id) || null,
          clientName,
          payerId: text(row.payer_profile_id) || null,
          payerName: text(payer?.payer_name) || null,
          totalCharge: num(row.total_charge),
          status: text(row.claim_status),
        });
      }
    }

    for (const [cid, bid] of claimToBatch.entries()) {
      const cs = claimSummaries.get(cid);
      if (!cs) continue;
      const arr = claimsByBatch.get(bid) ?? [];
      arr.push(cs);
      claimsByBatch.set(bid, arr);
    }

    // ── Resolve display names for billers (created_by + assignee picker) ────
    const creatorIds = Array.from(
      new Set(
        batches.map((b) => text(b.created_by_user_id)).filter((v) => v.length > 0),
      ),
    );
    const displayNameByUserId = new Map<string, string>();
    const billers: Biller[] = [];
    {
      // Pull every billing-capable staff member for the assignee picker
      // AND join in any creator ids we already have (in case the creator
      // was archived). The staff_members table is small (per-org), so a
      // full scan with a select projection is cheap.
      const { data: staffRows } = await (supabase as any)
        .from("staff_members")
        .select("id, auth_user_id, first_name, last_name, is_active, archived_at")
        .eq("organization_id", organizationId);
      for (const row of ((staffRows ?? []) as DbRow[])) {
        const uid = text(row.auth_user_id);
        const display =
          [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ").trim() ||
          uid.slice(0, 8) ||
          "(unknown)";
        if (uid) displayNameByUserId.set(uid, display);
        if (row.is_active && !row.archived_at && uid) {
          billers.push({ id: uid, displayName: display });
        }
      }
      // Make sure every creator is resolvable, even if their staff row
      // is now archived/missing.
      for (const id of creatorIds) {
        if (!displayNameByUserId.has(id)) displayNameByUserId.set(id, id.slice(0, 8));
      }
    }
    billers.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // ── Compose rows ───────────────────────────────────────────────────────
    const items: OrphanedBatchRow[] = batches.map((b) => {
      const id = text(b.id);
      const claims = claimsByBatch.get(id) ?? [];
      const totalCharges = claims.reduce((s, c) => s + c.totalCharge, 0);
      const creatorId = text(b.created_by_user_id) || null;
      const errorDetail =
        b.last_generation_error_detail && typeof b.last_generation_error_detail === "object"
          ? (b.last_generation_error_detail as OrphanedBatchRow["errorDetail"])
          : null;
      return {
        id,
        batchNumber: text(b.batch_number) || id.slice(0, 8),
        batchStatus: text(b.batch_status),
        claimCount: typeof b.claim_count === "number" ? b.claim_count : claims.length,
        totalCharges,
        errorMessage: text(b.last_generation_error) || "Validator failure",
        errorDetail,
        attemptedAt: text(b.last_generation_attempted_at) || null,
        agingDays: ageDays(text(b.last_generation_attempted_at) || text(b.updated_at)),
        createdAt: text(b.created_at),
        updatedAt: text(b.updated_at),
        createdByUserId: creatorId,
        createdByDisplayName:
          text(b.created_by_display_name) ||
          (creatorId ? displayNameByUserId.get(creatorId) ?? null : null),
        claims,
      };
    });

    return NextResponse.json({
      success: true,
      items,
      billers,
      sessionUserId: guard.userId,
    });
  } catch (error) {
    console.error("[orphaned-batches] GET error", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load" },
      { status: 500 },
    );
  }
}
