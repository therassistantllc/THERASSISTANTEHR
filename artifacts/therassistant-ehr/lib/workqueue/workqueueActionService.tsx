import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export interface WorkqueueActionInput {
  organizationId: string;
  workqueueItemId: string;
  userId?: string | null;
  comment?: string | null;
}

export interface AssignWorkqueueInput extends WorkqueueActionInput {
  assignedToUserId: string;
}

export interface DeferWorkqueueInput extends WorkqueueActionInput {
  deferredUntil: string;
  deferReason?: string | null;
}

export interface WorkqueueActionResult {
  ok: boolean;
  workqueueItemId: string;
  status: string | null;
  errors: Array<{ field: string; message: string }>;
}

type WorkqueueItem = {
  id: string;
  status: string;
  client_id: string | null;
  claim_id: string | null;
  professional_claim_id: string | null;
  billing_alert_id: string | null;
  ticket_id: string | null;
  encounter_id: string | null;
};

async function loadWorkqueueItem(organizationId: string, workqueueItemId: string) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("workqueue_items")
    .select("id, status, client_id, claim_id, professional_claim_id, billing_alert_id, ticket_id, encounter_id")
    .eq("organization_id", organizationId)
    .eq("id", workqueueItemId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as WorkqueueItem | null;
}

async function createBillingAlert(params: {
  organizationId: string;
  workqueueItemId: string;
  clientId?: string | null;
  claimId?: string | null;
  encounterId?: string | null;
  alertType: string;
  severity: "info" | "warning" | "critical";
  alertStatus: "open" | "acknowledged" | "resolved" | "dismissed";
  title: string;
  description?: string | null;
}): Promise<string | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("billing_alerts")
    .insert({
      organization_id: params.organizationId,
      workqueue_item_id: params.workqueueItemId,
      client_id: params.clientId ?? null,
      claim_id: params.claimId ?? null,
      encounter_id: params.encounterId ?? null,
      alert_type: params.alertType,
      severity: params.severity,
      alert_status: params.alertStatus,
      title: params.title,
      description: params.description ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return null;

  // Link the billing alert back to the workqueue item
  await supabase
    .from("workqueue_items")
    .update({ billing_alert_id: data.id, updated_at: new Date().toISOString() })
    .eq("organization_id", params.organizationId)
    .eq("id", params.workqueueItemId);

  return data.id;
}

async function addComment(params: {
  organizationId: string;
  workqueueItemId: string;
  commentBody: string;
  commentType: "note" | "status_change" | "assignment" | "defer" | "resolution";
  userId?: string | null;
}) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const body = params.commentBody.trim();
  if (!body) return;

  const { error } = await supabase.from("workqueue_item_comments").insert({
    organization_id: params.organizationId,
    workqueue_item_id: params.workqueueItemId,
    comment_body: body,
    comment_type: params.commentType,
    created_by_user_id: params.userId ?? null,
  });

  if (error) throw new Error(error.message);
}

function baseError(input: WorkqueueActionInput, message: string): WorkqueueActionResult {
  return {
    ok: false,
    workqueueItemId: input.workqueueItemId,
    status: null,
    errors: [{ field: "workqueue_items", message }],
  };
}

export async function addWorkqueueComment(input: WorkqueueActionInput): Promise<WorkqueueActionResult> {
  const item = await loadWorkqueueItem(input.organizationId, input.workqueueItemId);
  if (!item) return baseError(input, "Workqueue item not found");

  await addComment({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    commentBody: input.comment ?? "",
    commentType: "note",
    userId: input.userId ?? null,
  });

  return { ok: true, workqueueItemId: input.workqueueItemId, status: item.status, errors: [] };
}

export async function assignWorkqueueItem(input: AssignWorkqueueInput): Promise<WorkqueueActionResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return baseError(input, "Database connection not available");

  const item = await loadWorkqueueItem(input.organizationId, input.workqueueItemId);
  if (!item) return baseError(input, "Workqueue item not found");

  const { error } = await supabase
    .from("workqueue_items")
    .update({
      assigned_to_user_id: input.assignedToUserId,
      status: item.status === "open" ? "in_progress" : item.status,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.workqueueItemId);

  if (error) return baseError(input, error.message);

  await addComment({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    commentBody: input.comment ?? `Assigned workqueue item to ${input.assignedToUserId}`,
    commentType: "assignment",
    userId: input.userId ?? null,
  });

  return {
    ok: true,
    workqueueItemId: input.workqueueItemId,
    status: item.status === "open" ? "in_progress" : item.status,
    errors: [],
  };
}

export async function deferWorkqueueItem(input: DeferWorkqueueInput): Promise<WorkqueueActionResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return baseError(input, "Database connection not available");

  const item = await loadWorkqueueItem(input.organizationId, input.workqueueItemId);
  if (!item) return baseError(input, "Workqueue item not found");

  const deferredDate = new Date(input.deferredUntil);
  if (Number.isNaN(deferredDate.getTime())) {
    return {
      ok: false,
      workqueueItemId: input.workqueueItemId,
      status: item.status,
      errors: [{ field: "deferredUntil", message: "deferredUntil must be a valid date" }],
    };
  }

  const { error } = await supabase
    .from("workqueue_items")
    .update({
      deferred_until: deferredDate.toISOString(),
      defer_reason: input.deferReason ?? input.comment ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.workqueueItemId);

  if (error) return baseError(input, error.message);

  await addComment({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    commentBody: input.comment ?? `Deferred until ${deferredDate.toISOString()}`,
    commentType: "defer",
    userId: input.userId ?? null,
  });

  await createBillingAlert({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    clientId: item.client_id,
    claimId: item.professional_claim_id ?? null,
    encounterId: item.encounter_id,
    alertType: "other",
    severity: "info",
    alertStatus: "open",
    title: "Workqueue item deferred",
    description: input.deferReason ?? input.comment ?? `Deferred until ${deferredDate.toISOString()}`,
  });

  return { ok: true, workqueueItemId: input.workqueueItemId, status: item.status, errors: [] };
}

export async function resolveWorkqueueItem(input: WorkqueueActionInput): Promise<WorkqueueActionResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return baseError(input, "Database connection not available");

  const item = await loadWorkqueueItem(input.organizationId, input.workqueueItemId);
  if (!item) return baseError(input, "Workqueue item not found");

  const { error } = await supabase
    .from("workqueue_items")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: input.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.workqueueItemId);

  if (error) return baseError(input, error.message);

  await addComment({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    commentBody: input.comment ?? "Resolved workqueue item",
    commentType: "resolution",
    userId: input.userId ?? null,
  });

  await createBillingAlert({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    clientId: item.client_id,
    claimId: item.professional_claim_id ?? null,
    encounterId: item.encounter_id,
    alertType: "other",
    severity: "info",
    alertStatus: "resolved",
    title: "Workqueue item resolved",
    description: input.comment ?? "Workqueue item marked as resolved",
  });

  return { ok: true, workqueueItemId: input.workqueueItemId, status: "resolved", errors: [] };
}

export interface BulkWorkqueueActionInput {
  organizationId: string;
  workqueueItemIds: string[];
  action: "resolve" | "close" | "defer";
  userId?: string | null;
  comment?: string | null;
  deferredUntil?: string | null;
  deferReason?: string | null;
}

export interface BulkWorkqueueActionResult {
  ok: boolean;
  action: BulkWorkqueueActionInput["action"];
  totalCount: number;
  successCount: number;
  failedCount: number;
  results: WorkqueueActionResult[];
}

/**
 * Apply a single terminal action (resolve / close / defer) to many workqueue
 * items in one call. Iterates sequentially over each id and aggregates the
 * per-item WorkqueueActionResult so the caller can render partial-success
 * feedback. `ok` is true only when every item succeeded.
 */
export async function bulkWorkqueueAction(input: BulkWorkqueueActionInput): Promise<BulkWorkqueueActionResult> {
  const ids = Array.from(new Set((input.workqueueItemIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const action = input.action;

  if (ids.length === 0) {
    return {
      ok: false,
      action,
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  if (action === "defer" && !input.deferredUntil) {
    return {
      ok: false,
      action,
      totalCount: ids.length,
      successCount: 0,
      failedCount: ids.length,
      results: ids.map((id) => ({
        ok: false,
        workqueueItemId: id,
        status: null,
        errors: [{ field: "deferredUntil", message: "deferredUntil is required for bulk defer" }],
      })),
    };
  }

  const results: WorkqueueActionResult[] = [];
  for (const workqueueItemId of ids) {
    const base = {
      organizationId: input.organizationId,
      workqueueItemId,
      userId: input.userId ?? null,
      comment: input.comment ?? null,
    };
    try {
      if (action === "resolve") {
        results.push(await resolveWorkqueueItem(base));
      } else if (action === "close") {
        results.push(await closeWorkqueueItem(base));
      } else {
        results.push(
          await deferWorkqueueItem({
            ...base,
            deferredUntil: String(input.deferredUntil),
            deferReason: input.deferReason ?? input.comment ?? null,
          }),
        );
      }
    } catch (error) {
      results.push({
        ok: false,
        workqueueItemId,
        status: null,
        errors: [{ field: "workqueue_items", message: error instanceof Error ? error.message : "Bulk action failed" }],
      });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - successCount;
  return {
    ok: failedCount === 0,
    action,
    totalCount: results.length,
    successCount,
    failedCount,
    results,
  };
}

export async function closeWorkqueueItem(input: WorkqueueActionInput): Promise<WorkqueueActionResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return baseError(input, "Database connection not available");

  const item = await loadWorkqueueItem(input.organizationId, input.workqueueItemId);
  if (!item) return baseError(input, "Workqueue item not found");

  const { error } = await supabase
    .from("workqueue_items")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by_user_id: input.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.workqueueItemId);

  if (error) return baseError(input, error.message);

  await addComment({
    organizationId: input.organizationId,
    workqueueItemId: input.workqueueItemId,
    commentBody: input.comment ?? "Closed workqueue item",
    commentType: "status_change",
    userId: input.userId ?? null,
  });

  return { ok: true, workqueueItemId: input.workqueueItemId, status: "closed", errors: [] };
}
