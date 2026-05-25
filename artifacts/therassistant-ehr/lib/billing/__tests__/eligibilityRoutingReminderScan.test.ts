/**
 * Tests for the scheduled eligibility-routing reminder scan (Task #702).
 *
 * Verifies:
 *   1. Items still open past the threshold get a fresh reminder, the
 *      reminders log gets a new row, and an audit_logs entry is written
 *      with action='eligibility_routing_reminder_sent'.
 *   2. Items already reminded inside the window are skipped (no duplicate
 *      emails on every scan tick).
 *   3. Items updated more recently than the threshold are not scanned.
 *   4. The assignee's email_on_eligibility_routing=false preference is
 *      respected (no email, but the scan still logs an attempt so we
 *      don't keep re-checking).
 *   5. Reminder number increments across consecutive scans.
 *
 * The Resend HTTP call is mocked out at the module boundary so the test
 * never touches the network — we only assert the in-memory effects.
 */
import { strict as assert } from "node:assert";
import { describe, it, mock } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;

interface InsertCall {
  table: string;
  payload: Row;
}

function fakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const inserts: InsertCall[] = [];

  function build(table: string) {
    let rows: Row[] = [...(tables[table] ?? [])];
    const self: Record<string, unknown> = {};

    Object.assign(self, {
      select: () => self,
      order: () => self,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => (r[col] ?? null) === val);
        return self;
      },
      in: (col: string, vals: unknown[]) => {
        const set = new Set(vals);
        rows = rows.filter((r) => set.has(r[col] as unknown));
        return self;
      },
      is: (col: string, val: unknown) => {
        rows = rows.filter((r) => (r[col] ?? null) === val);
        return self;
      },
      lte: (col: string, val: unknown) => {
        rows = rows.filter((r) => {
          const v = r[col];
          if (v == null) return false;
          return String(v) <= String(val);
        });
        return self;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      insert: (payload: Row | Row[]) => {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const p of list) {
          inserts.push({ table, payload: p });
          tables[table] = tables[table] ?? [];
          tables[table].push({ ...p });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    });
    return self;
  }

  return {
    sb: { from: (t: string) => build(t) },
    inserts,
    tables,
  };
}

const ORG = "00000000-0000-0000-0000-000000000001";
const STAFF = "00000000-0000-0000-0000-000000000010";
const APPT = "00000000-0000-0000-0000-000000000100";
const CLIENT = "00000000-0000-0000-0000-000000000200";
const ITEM = "00000000-0000-0000-0000-000000001000";

function baseSeed(opts?: {
  updatedAt?: string;
  reminders?: Row[];
  prefs?: Row[];
}) {
  return {
    workqueue_items: [
      {
        id: ITEM,
        organization_id: ORG,
        work_type: "eligibility_routed_admin",
        status: "open",
        source_object_type: "appointment",
        source_object_id: APPT,
        client_id: CLIENT,
        assigned_to_user_id: STAFF,
        updated_at: opts?.updatedAt ?? "2026-05-23T00:00:00.000Z",
        created_at: "2026-05-23T00:00:00.000Z",
        context_payload: { note: "Verify policy before billing" },
        archived_at: null,
      },
    ],
    eligibility_routing_reminders: opts?.reminders ?? [],
    staff_profiles: [
      {
        id: STAFF,
        organization_id: ORG,
        first_name: "Sam",
        last_name: "Biller",
        email: "sam@example.test",
        is_active: true,
        archived_at: null,
      },
    ],
    appointments: [
      {
        id: APPT,
        organization_id: ORG,
        scheduled_start_at: "2026-05-26T15:00:00.000Z",
        client_id: CLIENT,
      },
    ],
    clients: [
      {
        id: CLIENT,
        organization_id: ORG,
        first_name: "Ada",
        last_name: "Lovelace",
        preferred_name: null,
      },
    ],
    staff_notification_preferences: opts?.prefs ?? [],
    audit_logs: [],
  };
}

// Mock the Resend wrapper so it never hits the network. The wrapper is
// invoked from deliverEligibilityRoutingNotification which we import
// transitively through the scan module.
const RESEND_URL = pathToFileURL(
  resolve(process.cwd(), "lib/email/resend.ts"),
).href;
mock.module(RESEND_URL, {
  namedExports: {
    sendEligibilityRoutedEmail: async (input: { isReminder?: boolean }) => ({
      ok: true,
      providerId: input.isReminder ? "reminder-id" : "initial-id",
      fromEmail: "noreply@example.test",
    }),
  },
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runEligibilityRoutingReminderScan } =
  require("../eligibilityRoutingReminderScan") as typeof import("../eligibilityRoutingReminderScan");

const NOW = new Date("2026-05-25T00:00:00.000Z");

describe("runEligibilityRoutingReminderScan", () => {
  it("sends a reminder for an open item past the threshold", async () => {
    const { sb, inserts, tables } = fakeSupabase(
      baseSeed({ updatedAt: "2026-05-23T00:00:00.000Z" }),
    );
    const result = await runEligibilityRoutingReminderScan({
      sb,
      organizationId: ORG,
      thresholdHours: 24,
      now: NOW,
    });
    assert.equal(result.scanned, 1);
    assert.equal(result.remindersSent, 1);
    assert.equal(result.items[0].reminderNumber, 1);
    assert.equal(result.items[0].emailSent, true);

    const reminderInserts = inserts.filter(
      (i) => i.table === "eligibility_routing_reminders",
    );
    assert.equal(reminderInserts.length, 1);
    assert.equal(reminderInserts[0].payload.reminder_number, 1);
    assert.equal(reminderInserts[0].payload.email_sent, true);

    const audits = (tables.audit_logs ?? []).filter(
      (r) => r.action === "eligibility_routing_reminder_sent",
    );
    assert.equal(audits.length, 1);
    assert.equal(audits[0].object_type, "workqueue_item");
    assert.equal(audits[0].object_id, ITEM);
  });

  it("skips items reminded within the window (no duplicate emails)", async () => {
    const { sb, inserts } = fakeSupabase(
      baseSeed({
        updatedAt: "2026-05-23T00:00:00.000Z",
        reminders: [
          {
            workqueue_item_id: ITEM,
            organization_id: ORG,
            reminder_number: 1,
            sent_at: "2026-05-24T20:00:00.000Z", // 4h ago
          },
        ],
      }),
    );
    const result = await runEligibilityRoutingReminderScan({
      sb,
      organizationId: ORG,
      thresholdHours: 24,
      now: NOW,
    });
    assert.equal(result.scanned, 1);
    assert.equal(result.remindersSent, 0);
    assert.equal(result.items[0].skipped, "reminded_within_window");
    assert.equal(
      inserts.filter((i) => i.table === "eligibility_routing_reminders").length,
      0,
    );
  });

  it("skips items whose last activity is newer than the threshold", async () => {
    const { sb } = fakeSupabase(
      baseSeed({ updatedAt: "2026-05-24T18:00:00.000Z" }),
    );
    const result = await runEligibilityRoutingReminderScan({
      sb,
      organizationId: ORG,
      thresholdHours: 24,
      now: NOW,
    });
    assert.equal(result.scanned, 0);
    assert.equal(result.remindersSent, 0);
  });

  it("respects email_on_eligibility_routing=false and still logs the attempt", async () => {
    const { sb, inserts } = fakeSupabase(
      baseSeed({
        updatedAt: "2026-05-23T00:00:00.000Z",
        prefs: [
          {
            staff_id: STAFF,
            email_on_eligibility_routing: false,
            inapp_on_eligibility_routing: true,
          },
        ],
      }),
    );
    const result = await runEligibilityRoutingReminderScan({
      sb,
      organizationId: ORG,
      thresholdHours: 24,
      now: NOW,
    });
    assert.equal(result.scanned, 1);
    assert.equal(result.remindersSent, 0);
    assert.equal(result.items[0].emailSent, false);
    const reminderInserts = inserts.filter(
      (i) => i.table === "eligibility_routing_reminders",
    );
    assert.equal(reminderInserts.length, 1);
    assert.equal(reminderInserts[0].payload.email_sent, false);
  });

  it("increments reminder_number across scans", async () => {
    const { sb, inserts } = fakeSupabase(
      baseSeed({
        updatedAt: "2026-05-22T00:00:00.000Z",
        reminders: [
          {
            workqueue_item_id: ITEM,
            organization_id: ORG,
            reminder_number: 2,
            sent_at: "2026-05-23T00:00:00.000Z", // > 24h ago
          },
        ],
      }),
    );
    const result = await runEligibilityRoutingReminderScan({
      sb,
      organizationId: ORG,
      thresholdHours: 24,
      now: NOW,
    });
    assert.equal(result.items[0].reminderNumber, 3);
    const reminderInserts = inserts.filter(
      (i) => i.table === "eligibility_routing_reminders",
    );
    assert.equal(reminderInserts[0].payload.reminder_number, 3);
  });
});
