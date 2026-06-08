/**
 * Task #625: notify the assignee when an eligibility issue is routed to them.
 *
 * The actual inbox row is created by `upsertInboxItem` in the actions route
 * (that's the in-app notification — it makes the item show up in My Inbox
 * with an unread badge). This module is the *delivery* layer: it checks the
 * assignee's per-user preferences and, if email is enabled, sends a Resend
 * email linking back to /billing/my-inbox.
 *
 * Every call returns a structured `NotificationDeliveryResult` so the caller
 * (the actions route) can persist what happened in the audit log — the task
 * spec requires an audit entry that captures whether the notification was
 * sent.
 */

import { sendEligibilityRoutedEmail } from "@/lib/email/resend";

export type NotificationChannelResult =
  | { channel: "email"; status: "sent"; providerId: string | null; fromEmail: string }
  | { channel: "email"; status: "skipped"; reason: string }
  | { channel: "email"; status: "failed"; error: string }
  | { channel: "in_app"; status: "sent"; inboxItemId: string }
  | { channel: "in_app"; status: "skipped"; reason: string };

export interface NotificationDeliveryResult {
  attempts: NotificationChannelResult[];
  emailSent: boolean;
  inAppSent: boolean;
}

interface PreferenceRow {
  email_on_eligibility_routing: boolean | null;
  inapp_on_eligibility_routing: boolean | null;
}

function pickBaseUrl(): string | null {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (!fromEnv) return null;
  return fromEnv.replace(/\/+$/, "");
}

export function buildInboxUrl(): string {
  const base = pickBaseUrl();
  return base ? `${base}/billing/my-inbox` : "/billing/my-inbox";
}

export interface DeliverEligibilityRoutingNotificationArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (t: string) => any };
  organizationId: string;
  assignee: {
    staffId: string;
    name: string;
    email: string | null;
  };
  kind: "clinician" | "admin";
  inboxItemId: string | null;
  routedByName: string | null;
  patientName: string | null;
  appointmentAt: string | null;
  note: string;
  // Task #702: when true, prefix the email subject with "Reminder" so the
  // assignee can tell at a glance this is a follow-up nudge rather than the
  // initial routing. The body + opt-out preference are identical to the
  // initial send, on purpose — we don't want a second class of "you can't
  // opt out of reminders" emails.
  isReminder?: boolean;
  reminderNumber?: number;
}

export async function deliverEligibilityRoutingNotification(
  args: DeliverEligibilityRoutingNotificationArgs,
): Promise<NotificationDeliveryResult> {
  const attempts: NotificationChannelResult[] = [];

  // In-app is just the workqueue row that was already upserted by the
  // caller. We surface it here so the audit log has a single coherent
  // record of every channel we attempted.
  if (args.inboxItemId) {
    attempts.push({
      channel: "in_app",
      status: "sent",
      inboxItemId: args.inboxItemId,
    });
  } else {
    attempts.push({
      channel: "in_app",
      status: "skipped",
      reason: "Inbox item was not created",
    });
  }

  // Per-user preferences. Missing row = defaults (everything on).
  let prefs: PreferenceRow = {
    email_on_eligibility_routing: true,
    inapp_on_eligibility_routing: true,
  };
  try {
    const { data } = await args.sb
      .from("staff_notification_preferences")
      .select("email_on_eligibility_routing, inapp_on_eligibility_routing")
      .eq("staff_id", args.assignee.staffId)
      .maybeSingle();
    if (data) prefs = data as PreferenceRow;
  } catch {
    // Treat lookup failures as "use defaults" rather than dropping the
    // notification — the worst case is the assignee gets one extra email.
  }

  if (prefs.email_on_eligibility_routing === false) {
    attempts.push({
      channel: "email",
      status: "skipped",
      reason: "Assignee opted out of routing emails",
    });
    return summarize(attempts);
  }

  if (!args.assignee.email) {
    attempts.push({
      channel: "email",
      status: "skipped",
      reason: "Assignee has no email on file",
    });
    return summarize(attempts);
  }

  const result = await sendEligibilityRoutedEmail({
    to: args.assignee.email,
    assigneeName: args.assignee.name,
    routedByName: args.routedByName,
    patientName: args.patientName,
    appointmentAt: args.appointmentAt,
    kind: args.kind,
    note: args.note,
    inboxUrl: buildInboxUrl(),
    isReminder: args.isReminder ?? false,
    reminderNumber: args.reminderNumber,
  });

  if (result.ok) {
    attempts.push({
      channel: "email",
      status: "sent",
      providerId: result.providerId,
      fromEmail: result.fromEmail,
    });
  } else {
    attempts.push({
      channel: "email",
      status: "failed",
      error: result.error,
    });
  }

  return summarize(attempts);
}

function summarize(attempts: NotificationChannelResult[]): NotificationDeliveryResult {
  return {
    attempts,
    emailSent: attempts.some(
      (a) => a.channel === "email" && a.status === "sent",
    ),
    inAppSent: attempts.some(
      (a) => a.channel === "in_app" && a.status === "sent",
    ),
  };
}
