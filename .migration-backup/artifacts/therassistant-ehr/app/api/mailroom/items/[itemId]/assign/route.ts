import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function staffDisplayName(staff: DbRow | null) {
  if (!staff) return "";
  return [text(staff.first_name), text(staff.last_name)].filter(Boolean).join(" ") || text(staff.email);
}

export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      organizationId?: string;
      assignedToUserId?: string | null;
    };

    const guard = await requireOrgAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    if (!itemId) {
      return NextResponse.json({ success: false, error: "itemId is required" }, { status: 400 });
    }

    const assignedToUserId = text(body.assignedToUserId) || null;

    let assignee: DbRow | null = null;
    if (assignedToUserId) {
      const { data: staff, error: staffErr } = await supabase
        .from("staff_profiles")
        .select("id, auth_user_id, first_name, last_name, email")
        .eq("organization_id", organizationId)
        .eq("auth_user_id", assignedToUserId)
        .is("archived_at", null)
        .maybeSingle();
      if (staffErr || !staff) {
        return NextResponse.json({ success: false, error: "Assignee not found in your organization" }, { status: 404 });
      }
      assignee = staff as DbRow;
    }

    const { data: item, error: itemErr } = await supabase
      .from("mailroom_items")
      .select("id, file_name, notes, workqueue_item_id")
      .eq("organization_id", organizationId)
      .eq("id", itemId)
      .is("archived_at", null)
      .maybeSingle();

    if (itemErr || !item) {
      return NextResponse.json({ success: false, error: "Mailroom item not found" }, { status: 404 });
    }

    let workqueueItemId = text((item as DbRow).workqueue_item_id) || null;

    if (!workqueueItemId) {
      const now = new Date().toISOString();
      const { data: createdWq, error: createWqErr } = await supabase
        .from("workqueue_items")
        .insert({
          organization_id: organizationId,
          source_object_type: "mailroom_item",
          source_object_id: itemId,
          work_type: "mailroom_review",
          status: "open",
          priority: "normal",
          title: `Mailroom review - ${text((item as DbRow).file_name) || itemId.slice(0, 8)}`,
          description: text((item as DbRow).notes) || null,
          assigned_to_user_id: assignedToUserId,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (createWqErr || !createdWq) {
        return NextResponse.json(
          { success: false, error: createWqErr?.message || "Failed to create workqueue item" },
          { status: 422 },
        );
      }

      workqueueItemId = text((createdWq as DbRow).id);

      await supabase
        .from("mailroom_items")
        .update({ workqueue_item_id: workqueueItemId, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", itemId);
    } else {
      const { error: assignErr } = await supabase
        .from("workqueue_items")
        .update({
          assigned_to_user_id: assignedToUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("id", workqueueItemId);
      if (assignErr) {
        return NextResponse.json(
          { success: false, error: assignErr.message || "Failed to assign document" },
          { status: 422 },
        );
      }
    }

    try {
      await supabase.from("workqueue_item_comments").insert({
        organization_id: organizationId,
        workqueue_item_id: workqueueItemId,
        comment_body: assignedToUserId
          ? `Assigned mailroom item to ${staffDisplayName(assignee) || assignedToUserId}`
          : "Cleared mailroom item assignment",
        comment_type: "assignment",
        created_by_user_id: guard.userId || null,
      });
    } catch {
      // Best effort only.
    }

    return NextResponse.json({
      success: true,
      workqueueItemId,
      assignedToUserId,
      assigneeName: staffDisplayName(assignee) || null,
    });
  } catch (error) {
    console.error("Mailroom assign API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Assignment failed" },
      { status: 500 },
    );
  }
}
