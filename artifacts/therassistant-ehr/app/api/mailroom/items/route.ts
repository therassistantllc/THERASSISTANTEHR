import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
type DbRow = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function itemDto(row: DbRow) {
  return {
    id: clean(row.id),
    organizationId: clean(row.organization_id),
    clientId: clean(row.client_id),
    clientName: clean(row.client_name) || null,
    workqueueItemId: clean(row.workqueue_item_id) || null,
    assignedToUserId: clean(row.assigned_to_user_id) || null,
    assigneeName: clean(row.assignee_name) || null,
    fileName: clean(row.file_name),
    mimeType: clean(row.mime_type),
    storagePath: clean(row.storage_path),
    status: clean(row.status),
    documentType: clean(row.document_type),
    source: clean(row.source),
    notes: clean(row.notes),
    adminComments: clean(row.admin_comments),
    uploadedByUserId: clean(row.uploaded_by_user_id),
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
  };
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { searchParams } = new URL(request.url);

    // Per-clinician scoping: signed-in staff see only their own email-derived
    // mailroom items, plus any org-scoped items (owner_user_id IS NULL) such
    // as manually uploaded documents that aren't tied to a clinician.
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const ctx = { userId: guard.userId };
    const status = searchParams.get("status") || "active";
    const clientId = searchParams.get("clientId") || null;
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 100);

    let query = supabase
      .from("mailroom_items")
      .select("id, organization_id, client_id, file_name, mime_type, storage_path, status, document_type, source, notes, admin_comments, uploaded_by_user_id, created_at, updated_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ctx?.userId) {
      query = query.or(`owner_user_id.is.null,owner_user_id.eq.${ctx.userId}`);
    }

    if (status === "active") query = query.neq("status", "filed");
    else if (status !== "all") query = query.eq("status", status);
    if (clientId) query = query.eq("client_id", clientId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    const rows = ((data ?? []) as DbRow[]);
    const clientIds = [...new Set(rows.map((r) => clean(r.client_id)).filter(Boolean))];
    const workqueueIds = [...new Set(rows.map((r) => clean(r.workqueue_item_id)).filter(Boolean))];

    const [{ data: clients }, { data: workqueueRows }] = await Promise.all([
      clientIds.length
        ? supabase
            .from("clients")
            .select("id, first_name, last_name")
            .in("id", clientIds)
            .eq("organization_id", organizationId)
        : Promise.resolve({ data: [] as DbRow[] }),
      workqueueIds.length
        ? supabase
            .from("workqueue_items")
            .select("id, assigned_to_user_id")
            .in("id", workqueueIds)
            .eq("organization_id", organizationId)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);

    const clientById = new Map<string, DbRow>(((clients ?? []) as DbRow[]).map((c) => [clean(c.id), c]));
    const workqueueById = new Map<string, DbRow>(((workqueueRows ?? []) as DbRow[]).map((w) => [clean(w.id), w]));

    const assigneeAuthUserIds = [
      ...new Set(
        ((workqueueRows ?? []) as DbRow[])
          .map((w) => clean(w.assigned_to_user_id))
          .filter(Boolean),
      ),
    ];

    const { data: assignees } = assigneeAuthUserIds.length
      ? await supabase
          .from("staff_profiles")
          .select("auth_user_id, first_name, last_name, email")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .in("auth_user_id", assigneeAuthUserIds)
      : { data: [] as DbRow[] };

    const assigneeByAuthUserId = new Map<string, DbRow>(
      ((assignees ?? []) as DbRow[]).map((s) => [clean(s.auth_user_id), s]),
    );

    const enriched = rows.map((row) => {
      const clientId = clean(row.client_id);
      const workqueueId = clean(row.workqueue_item_id);
      const client = clientById.get(clientId);
      const workqueue = workqueueById.get(workqueueId);
      const assignedToUserId = clean(workqueue?.assigned_to_user_id);
      const assignee = assigneeByAuthUserId.get(assignedToUserId);
      const assigneeName = assignee
        ? [clean(assignee.first_name), clean(assignee.last_name)].filter(Boolean).join(" ") || clean(assignee.email)
        : "";

      return itemDto({
        ...row,
        client_name: client
          ? [clean(client.first_name), clean(client.last_name)].filter(Boolean).join(" ")
          : null,
        assigned_to_user_id: assignedToUserId || null,
        assignee_name: assigneeName || null,
      });
    });

    return NextResponse.json({ success: true, items: enriched });
  } catch (error) {
    console.error("Mailroom items API error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Mailroom items failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const body = await request.json();
    const guard = await requireOrgAccess({
      requestedOrganizationId: clean(body.organizationId),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const fileName = clean(body.fileName) || "uploaded-mailroom-document";
    const mimeType = clean(body.mimeType) || "application/pdf";
    const storagePath = clean(body.storagePath) || `manual-mailroom/${Date.now()}-${fileName}`;
    const clientId = clean(body.clientId) || null;
    const documentType = clean(body.documentType) || "payer_correspondence";
    const notes = clean(body.notes) || "Mailroom document routed for billing/admin review.";

    const { data, error } = await supabase
      .from("mailroom_items")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        file_name: fileName,
        mime_type: mimeType,
        storage_path: storagePath,
        status: "needs_review",
        document_type: documentType,
        source: clean(body.source) || "manual_upload",
        notes,
        uploaded_by_user_id: clean(body.uploadedByUserId) || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) return NextResponse.json({ success: false, error: error?.message || "Failed to create mailroom item" }, { status: 422 });

    const { error: workqueueError } = await supabase.from("workqueue_items").insert({
      organization_id: organizationId,
      title: `Mailroom review - ${fileName}`,
      description: notes,
      work_type: "mailroom_review",
      status: "open",
      priority: "normal",
      source_object_type: "mailroom_item",
      source_object_id: data.id,
      client_id: clientId,
      context_payload: {
        mailroom_item_id: data.id,
        document_type: documentType,
        file_name: fileName,
        storage_path: storagePath,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, mailroomItemId: data.id, workqueueCreated: !workqueueError, workqueueError: workqueueError?.message || null });
  } catch (error) {
    console.error("Create mailroom item API error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Create mailroom item failed" }, { status: 500 });
  }
}
