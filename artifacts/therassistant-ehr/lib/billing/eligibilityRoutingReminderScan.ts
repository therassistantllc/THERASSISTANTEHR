/**
 * Task #702: scan open eligibility routing handoffs and re-notify the
 * assignee when the item has been sitting past the configured threshold
 * without progress.
 *
 * "Past the threshold" means:
 *   - workqueue_items.work_type is one of the routed eligibility types,
 *   - status is still open/in_progress/blocked (not resolved/cancelled),
 *   - the last activity on the row (updated_at) is older than the
 *     threshold, AND
 *   - the last reminder we sent for that row (if any) is also older
 *     than the threshold — so re-running the scan every hour doesn't
 *     re-email the same person over and over.
 *
 * Each successful nudge writes:
 *   1. a `eligibility_routing_reminders` row (the reminders log), and
 *   2. an `audit_logs` event with a distinct action
 *      ("eligibility_routing_reminder_sent") so admins can audit reminder
 *      cadence separately from the initial routing.
 *
 * The assignee's per-user `email_on_eligibility_routing` preference is
 * honored via `deliverEligibilityRoutingNotification` (shared with the
 * initial routing path).
 */

import {
  deliverEligibilityRoutingNotification,
  type NotificationDeliveryResult,
} from "./eligibilityRoutingNotifier";

const ROUTED_WORK_TYPES = [
  "eligibility_routed_clinician",
  "eligibility_routed_admin",
] as const;
const OPEN_STATUSES = ["open", "in_progress", "blocked"] as const;

export const DEFAULT_REMINDER_THRESHOLD_HOURS = 24;

export interface ReminderScanItemResult {
  workqueueItemId: string;
  assignedToStaffId: string | null;
  organizationId: string;
  skipped?: string;
  reminderNumber?: number;
  emailSent?: boolean;
  notification?: NotificationDeliveryResult;
  error?: string;
}

export interface ReminderScanResult {
  organizationId: string;
  scanned: number;
  remindersSent: number;
  items: ReminderScanItemResult[];
}

export interface RunReminderScanArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (t: string) => any };
  organizationId: string;
  thresholdHours?: number;
  now?: Date;
}

interface WorkqueueRow {
  id: string;
  organization_id: string;
  work_type: string;
  status: string;
  source_object_type: string | null;
  source_object_id: string | null;
  client_id: string | null;
  assigned_to_user_id: string | null;
  updated_at: string;
  created_at: string;
  context_payload: Record<string, unknown> | null;
}

interface ReminderRow {
  workqueue_item_id: string;
  reminder_number: number | null;
  sent_at: string;
}

interface StaffRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

interface AppointmentRow {
  id: string;
  scheduled_start_at: string | null;
  client_id: string | null;
}

function displayName(s: StaffRow): string {
  const name = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  return name || (s.email ?? "") || s.id;
}

function clientDisplay(c: ClientRow | undefined): string | null {
  if (!c) return null;
  const name =
    c.preferred_name ||
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

async function writeReminderAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (t: string) => any },
  args: {
    organizationId: string;
    workqueueItem: WorkqueueRow;
    assignee: StaffRow;
    reminderNumber: number;
    notification: NotificationDeliveryResult | null;
    error?: string;
  },
) {
  try {
    const item = args.workqueueItem;
    await sb.from("audit_logs").insert({
      organization_id: args.organizationId,
      user_id: null,
      event_type: "eligibility_workqueue",
      action: "eligibility_routing_reminder_sent",
      event_summary: args.error
        ? `Reminder failed for ${displayName(args.assignee)}: ${args.error}`
        : `Reminder #${args.reminderNumber} sent to ${displayName(args.assignee)}`,
      object_type: "workqueue_item",
      object_id: item.id,
      appointment_id:
        item.source_object_type === "appointment" ? item.source_object_id : null,
      patient_id: item.client_id,
      event_metadata: {
        work_type: item.work_type,
        reminder_number: args.reminderNumber,
        assigned_to_staff_id: args.assignee.id,
        assigned_to_email: args.assignee.email,
        notification: args.notification ?? {
          attempts: [],
          emailSent: false,
          inAppSent: false,
        },
        error: args.error ?? null,
      },
    });
  } catch (e) {
    console.warn("eligibility reminder audit failed:", e);
  }
}

export async function runEligibilityRoutingReminderScan(
  args: RunReminderScanArgs,
): Promise<ReminderScanResult> {
  const sb = args.sb;
  const now = args.now ?? new Date();
  const thresholdHours = Math.max(
    1,
    args.thresholdHours ?? DEFAULT_REMINDER_THRESHOLD_HOURS,
  );
  const cutoffIso = new Date(
    now.getTime() - thresholdHours * 3600 * 1000,
  ).toISOString();

  const result: ReminderScanResult = {
    organizationId: args.organizationId,
    scanned: 0,
    remindersSent: 0,
    items: [],
  };

  // 1. Pull every open routed-eligibility item whose last activity is
  //    older than the cutoff. Activity = updated_at; routing & resolves
  //    both stamp updated_at, so this naturally excludes items that have
  //    been touched recently.
  const { data: itemsData, error: itemsErr } = await sb
    .from("workqueue_items")
    .select(
      "id, organization_id, work_type, status, source_object_type, source_object_id, client_id, assigned_to_user_id, updated_at, created_at, context_payload",
    )
    .eq("organization_id", args.organizationId)
    .in("work_type", ROUTED_WORK_TYPES as unknown as string[])
    .in("status", OPEN_STATUSES as unknown as string[])
    .lte("updated_at", cutoffIso)
    .is("archived_at", null);

  if (itemsErr) {
    throw new Error(
      `Failed to scan eligibility routing reminders: ${itemsErr.message ?? itemsErr}`,
    );
  }

  const items = (itemsData ?? []) as WorkqueueRow[];
  result.scanned = items.length;
  if (items.length === 0) return result;

  // 2. Pull the most-recent reminder per item so we can (a) skip items
  //    we've already nudged within the window and (b) increment
  //    reminder_number for ones we haven't.
  const itemIds = items.map((i) => i.id);
  const { data: reminderData } = await sb
    .from("eligibility_routing_reminders")
    .select("workqueue_item_id, reminder_number, sent_at")
    .eq("organization_id", args.organizationId)
    .in("workqueue_item_id", itemIds)
    .order("sent_at", { ascending: false });

  const latestReminderByItem = new Map<string, ReminderRow>();
  for (const r of ((reminderData ?? []) as ReminderRow[])) {
    if (!latestReminderByItem.has(r.workqueue_item_id)) {
      latestReminderByItem.set(r.workqueue_item_id, r);
    }
  }

  // 3. Resolve assignees + enrichment in batched queries.
  const assigneeIds = Array.from(
    new Set(items.map((i) => i.assigned_to_user_id).filter(Boolean) as string[]),
  );
  const staffById = new Map<string, StaffRow>();
  if (assigneeIds.length) {
    const { data: staff } = await sb
      .from("staff_profiles")
      .select("id, first_name, last_name, email, is_active, archived_at")
      .eq("organization_id", args.organizationId)
      .in("id", assigneeIds);
    for (const s of ((staff ?? []) as Array<
      StaffRow & { is_active: boolean | null; archived_at: string | null }
    >)) {
      if (s.archived_at) continue;
      if (s.is_active === false) continue;
      staffById.set(s.id, {
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        email: s.email,
      });
    }
  }

  const appointmentIds = Array.from(
    new Set(
      items
        .filter((i) => i.source_object_type === "appointment")
        .map((i) => i.source_object_id)
        .filter(Boolean) as string[],
    ),
  );
  const apptById = new Map<string, AppointmentRow>();
  if (appointmentIds.length) {
    const { data: appts } = await sb
      .from("appointments")
      .select("id, scheduled_start_at, client_id")
      .eq("organization_id", args.organizationId)
      .in("id", appointmentIds);
    for (const a of ((appts ?? []) as AppointmentRow[])) apptById.set(a.id, a);
  }

  const clientIds = Array.from(
    new Set(
      [
        ...items.map((i) => i.client_id).filter(Boolean),
        ...Array.from(apptById.values()).map((a) => a.client_id).filter(Boolean),
      ] as string[],
    ),
  );
  const clientById = new Map<string, ClientRow>();
  if (clientIds.length) {
    const { data: clients } = await sb
      .from("clients")
      .select("id, first_name, last_name, preferred_name")
      .eq("organization_id", args.organizationId)
      .in("id", clientIds);
    for (const c of ((clients ?? []) as ClientRow[])) clientById.set(c.id, c);
  }

  // 4. For each item, decide whether to remind, and if so, deliver +
  //    persist the log row + audit entry.
  for (const item of items) {
    const itemReport: ReminderScanItemResult = {
      workqueueItemId: item.id,
      organizationId: args.organizationId,
      assignedToStaffId: item.assigned_to_user_id,
    };

    const lastReminder = latestReminderByItem.get(item.id);
    if (lastReminder && new Date(lastReminder.sent_at).getTime() > new Date(cutoffIso).getTime()) {
      itemReport.skipped = "reminded_within_window";
      result.items.push(itemReport);
      continue;
    }

    if (!item.assigned_to_user_id) {
      itemReport.skipped = "unassigned";
      result.items.push(itemReport);
      continue;
    }
    const assignee = staffById.get(item.assigned_to_user_id);
    if (!assignee) {
      itemReport.skipped = "assignee_inactive_or_missing";
      result.items.push(itemReport);
      continue;
    }

    const kind: "clinician" | "admin" =
      item.work_type === "eligibility_routed_clinician" ? "clinician" : "admin";
    const reminderNumber = (lastReminder?.reminder_number ?? 0) + 1;

    const ctxPayload = (item.context_payload ?? {}) as Record<string, unknown>;
    const note = (ctxPayload.note as string | null) ?? "";

    const appt =
      item.source_object_type === "appointment" && item.source_object_id
        ? apptById.get(item.source_object_id) ?? null
        : null;
    const effectiveClientId = item.client_id ?? appt?.client_id ?? null;
    const patientName = effectiveClientId
      ? clientDisplay(clientById.get(effectiveClientId))
      : null;
    const appointmentAt = appt?.scheduled_start_at ?? null;

    let notification: NotificationDeliveryResult | null = null;
    let deliveryError: string | undefined;
    try {
      notification = await deliverEligibilityRoutingNotification({
        sb,
        organizationId: args.organizationId,
        assignee: {
          staffId: assignee.id,
          name: displayName(assignee),
          email: assignee.email,
        },
        kind,
        inboxItemId: item.id,
        routedByName: null,
        patientName,
        appointmentAt,
        note,
        isReminder: true,
        reminderNumber,
      });
    } catch (e) {
      deliveryError = e instanceof Error ? e.message : String(e);
    }

    // Always persist the reminder log so the next scan knows we tried —
    // even when email delivery failed. If we didn't persist, a flaky
    // upstream (Resend down, etc.) would cause us to re-email the same
    // assignee on every scan tick.
    try {
      await sb.from("eligibility_routing_reminders").insert({
        organization_id: args.organizationId,
        workqueue_item_id: item.id,
        assigned_to_staff_id: assignee.id,
        reminder_number: reminderNumber,
        sent_at: now.toISOString(),
        email_sent: notification?.emailSent ?? false,
        channel_attempts: notification?.attempts ?? [],
      });
    } catch (e) {
      console.warn("eligibility reminder log insert failed:", e);
    }

    await writeReminderAudit(sb, {
      organizationId: args.organizationId,
      workqueueItem: item,
      assignee,
      reminderNumber,
      notification,
      error: deliveryError,
    });

    itemReport.reminderNumber = reminderNumber;
    itemReport.emailSent = notification?.emailSent ?? false;
    itemReport.notification = notification ?? undefined;
    if (deliveryError) itemReport.error = deliveryError;
    if (notification?.emailSent) result.remindersSent += 1;
    result.items.push(itemReport);
  }

  return result;
}
