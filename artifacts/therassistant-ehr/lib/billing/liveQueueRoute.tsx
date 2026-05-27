/**
 * liveQueueRoute.ts
 * ───────────────────────────────────────────────────────────────────────────
 * Factory that produces Next.js route handlers (GET + POST) for any of the
 * 13 second-wave billing workqueues registered in `liveQueues.ts`.
 *
 * Usage in `app/api/billing/<queue>/route.ts`:
 *   export const { GET } = makeLiveQueueGet("payer-rejections");
 *
 * Usage in `app/api/billing/<queue>/action/route.ts`:
 *   export const { POST } = makeLiveQueueAction("payer-rejections");
 */

import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  LIVE_QUEUE_LOADERS,
  readUniversalFilters,
  recordQueueAction,
  undoQueueAction,
} from "@/lib/billing/liveQueues";

export function makeLiveQueueGet(endpoint: string) {
  async function GET(request: Request) {
    try {
      const supabase = createServerSupabaseAdminClient();
      if (!supabase) {
        return NextResponse.json(
          { success: false, error: "Database connection not available" },
          { status: 500 },
        );
      }
      const { searchParams } = new URL(request.url);
      const guard = await requireBillingAccess({
        requestedOrganizationId: searchParams.get("organizationId"),
      });
      if (guard instanceof NextResponse) return guard;
      const loader = LIVE_QUEUE_LOADERS[endpoint];
      if (!loader) {
        return NextResponse.json(
          { success: false, error: `Unknown queue "${endpoint}"` },
          { status: 404 },
        );
      }
      const tab = (searchParams.get("tab") ?? "").trim();
      const filters = readUniversalFilters(searchParams);
      const { items, summary } = await loader(
        supabase,
        guard.organizationId,
        tab,
        filters,
      );
      return NextResponse.json({
        success: true,
        organizationId: guard.organizationId,
        items,
        summary,
      });
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: e instanceof Error ? e.message : "Failed to load worklist",
        },
        { status: 500 },
      );
    }
  }
  return { GET };
}

export function makeLiveQueueAction(endpoint: string) {
  async function POST(request: Request) {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        action?: string;
        rowId?: string;
        organizationId?: string;
        [k: string]: unknown;
      };
      const guard = await requireBillingAccess({
        requestedOrganizationId: body.organizationId ?? null,
      });
      if (guard instanceof NextResponse) return guard;
      const action = String(body.action ?? "").trim();
      const rowId = String(body.rowId ?? "").trim();
      if (!action || !rowId) {
        return NextResponse.json(
          { success: false, error: "action and rowId are required" },
          { status: 400 },
        );
      }
      const { action: _a, rowId: _r, organizationId: _o, ...extras } = body;
      const result = await recordQueueAction(
        endpoint,
        guard.organizationId,
        rowId,
        action,
        guard.userId ?? null,
        extras,
      );
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: e instanceof Error ? e.message : "Action failed",
        },
        { status: 500 },
      );
    }
  }
  return { POST };
}

/**
 * Per-row "Undo last action" endpoint for the second-wave billing queues.
 *
 * POST body: { rowId: string, organizationId?: string }
 *
 * Dispatches to `undoQueueAction`, which (in a single Postgres txn) reverses
 * the most recent `<prefix>_*` audit_logs entry's mutation and stamps a
 * compensating `<prefix>_undo` log so the row moves back to its prior tab.
 * Returns 404 when there is no action to undo, 400 when a downstream action
 * (refund issued, reversal already archived, claim status drifted) makes the
 * undo unsafe.
 */
export function makeLiveQueueUndo(endpoint: string) {
  async function POST(request: Request) {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        rowId?: string;
        organizationId?: string;
      };
      const guard = await requireBillingAccess({
        requestedOrganizationId: body.organizationId ?? null,
      });
      if (guard instanceof NextResponse) return guard;
      const rowId = String(body.rowId ?? "").trim();
      if (!rowId) {
        return NextResponse.json(
          { success: false, error: "rowId is required" },
          { status: 400 },
        );
      }
      const result = await undoQueueAction(
        endpoint,
        guard.organizationId,
        rowId,
        guard.userId ?? null,
      );
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json({
        success: true,
        mutation: result.mutation,
        undoneEventType: result.undoneEventType,
        tab: result.tab,
      });
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: e instanceof Error ? e.message : "Undo failed",
        },
        { status: 500 },
      );
    }
  }
  return { POST };
}
