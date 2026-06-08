import { NextResponse } from "next/server";
import {
  addWorkqueueComment,
  assignWorkqueueItem,
  bulkWorkqueueAction,
  closeWorkqueueItem,
  deferWorkqueueItem,
  resolveWorkqueueItem,
} from "@/lib/workqueue/workqueueActionService";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.organizationId || !body.action) {
      return NextResponse.json(
        { success: false, error: "organizationId and action are required" },
        { status: 400 },
      );
    }

    // ── Bulk path: act on many items at once ────────────────────────────────
    if (body.action === "bulk") {
      const bulkAction = body.bulkAction ? String(body.bulkAction) : "";
      if (!["resolve", "close", "defer"].includes(bulkAction)) {
        return NextResponse.json(
          { success: false, error: "bulkAction must be one of: resolve, close, defer" },
          { status: 400 },
        );
      }
      const ids = Array.isArray(body.workqueueItemIds) ? body.workqueueItemIds.map((id: unknown) => String(id)) : [];
      if (ids.length === 0) {
        return NextResponse.json(
          { success: false, error: "workqueueItemIds must be a non-empty array" },
          { status: 400 },
        );
      }
      if (bulkAction === "defer" && !body.deferredUntil) {
        return NextResponse.json({ success: false, error: "deferredUntil is required for bulk defer" }, { status: 400 });
      }
      const result = await bulkWorkqueueAction({
        organizationId: String(body.organizationId),
        workqueueItemIds: ids,
        action: bulkAction as "resolve" | "close" | "defer",
        userId: body.userId ?? null,
        comment: body.comment ?? null,
        deferredUntil: body.deferredUntil ?? null,
        deferReason: body.deferReason ?? null,
      });
      return NextResponse.json({ success: result.ok, result }, { status: result.ok ? 200 : 207 });
    }

    if (!body.workqueueItemId) {
      return NextResponse.json(
        { success: false, error: "workqueueItemId is required" },
        { status: 400 },
      );
    }

    const base = {
      organizationId: String(body.organizationId),
      workqueueItemId: String(body.workqueueItemId),
      userId: body.userId ?? null,
      comment: body.comment ?? null,
    };

    let result;
    if (body.action === "comment") {
      result = await addWorkqueueComment(base);
    } else if (body.action === "assign") {
      if (!body.assignedToUserId) {
        return NextResponse.json({ success: false, error: "assignedToUserId is required" }, { status: 400 });
      }
      result = await assignWorkqueueItem({ ...base, assignedToUserId: String(body.assignedToUserId) });
    } else if (body.action === "defer") {
      if (!body.deferredUntil) {
        return NextResponse.json({ success: false, error: "deferredUntil is required" }, { status: 400 });
      }
      result = await deferWorkqueueItem({
        ...base,
        deferredUntil: String(body.deferredUntil),
        deferReason: body.deferReason ?? null,
      });
    } else if (body.action === "resolve") {
      result = await resolveWorkqueueItem(base);
    } else if (body.action === "close") {
      result = await closeWorkqueueItem(base);
    } else {
      return NextResponse.json({ success: false, error: `Unsupported workqueue action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json({ success: result.ok, result }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("Workqueue action API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Workqueue action failed" },
      { status: 500 },
    );
  }
}
