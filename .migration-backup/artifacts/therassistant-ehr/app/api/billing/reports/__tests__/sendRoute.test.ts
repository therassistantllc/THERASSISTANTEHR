/**
 * Coverage for POST /api/billing/reports/send (Task #781).
 *
 * Pins:
 *   - Recipient validation: empty, malformed, and over-limit lists
 *     are rejected with a 400 before any email or DB call.
 *   - Cross-org guard runs (requireBillingAccess mock returns the
 *     session org regardless of what the caller submits).
 *   - The report payload that goes into the email body is fetched
 *     through the same GET handler with the caller's month + scope
 *     preserved (so the email matches what's on screen).
 *   - sendBillingReportEmail is invoked with the parsed recipients,
 *     the formatted month label, and the trimmed/deduped emails.
 *   - Resend rejection bubbles up as a 502.
 */
import { strict as assert } from "node:assert";
import { before, beforeEach, mock, test } from "node:test";

const ORG = "org-1";

type EmailCall = Record<string, unknown>;
type ReportFetchCall = { url: string };

const state = {
  emailResult:
    null as
      | null
      | { ok: true; providerId: string | null; fromEmail: string }
      | { ok: false; error: string },
  emailCalls: [] as EmailCall[],
  reportFetchCalls: [] as ReportFetchCall[],
  reportResponse: null as null | Response,
  guardOverride: null as null | ((opts: Record<string, unknown>) => unknown),
};

function jsonRequest(body: unknown): Request {
  return new Request("https://app.test/api/billing/reports/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";

  mock.module("@/lib/billing/requireBillingAccess", {
    namedExports: {
      requireBillingAccess: async (opts: Record<string, unknown>) => {
        if (state.guardOverride) return state.guardOverride(opts);
        return {
          organizationId: ORG,
          staffId: "staff-1",
          userId: "user-1",
          roles: [],
          permissions: [],
          isDevPassthrough: false,
        };
      },
    },
  });

  mock.module("@/lib/rbac/auth", {
    namedExports: {
      requireAuthenticatedStaff: async () => ({
        staffId: "staff-1",
        organizationId: ORG,
        email: "owner@example.com",
        firstName: "Riley",
        lastName: "Owner",
        roles: [],
        permissions: [],
      }),
    },
  });

  mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseAdminClient: () => ({
        from: (_table: string) => ({
          select: (_cols: string) => ({
            eq: (_f: string, _v: unknown) => ({
              maybeSingle: async () => ({
                data: { name: "Sunrise Therapy Group" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    },
  });

  mock.module("@/lib/email/resend", {
    namedExports: {
      sendBillingReportEmail: async (input: EmailCall) => {
        state.emailCalls.push(input);
        if (!state.emailResult) throw new Error("test: emailResult not set");
        return state.emailResult;
      },
    },
  });

  // The send route imports GET from "../route" and invokes it to fetch
  // the same payload the page sees. Mock the parent route module so we
  // don't need a real Supabase connection.
  mock.module("../route", {
    namedExports: {
      GET: async (req: Request) => {
        state.reportFetchCalls.push({ url: req.url });
        if (state.reportResponse) return state.reportResponse;
        return new Response(
          JSON.stringify({
            success: true,
            month: "2026-04",
            claims: { submitted: 12, paid: 9, deniedOrRejected: 1, totalChargeSubmitted: 3200 },
            payments: { count: 9, totalAmount: 2750 },
            derived: {
              collectionRate: 86,
              netCollectionPct: 92,
              averageDaysInAR: 18.4,
              outstandingAR: 450,
              topDenial: { carcCode: "CO-45", occurrences: 3, payerName: "Aetna" },
            },
            aging: {
              bucket0to30: { count: 2, totalCharge: 250 },
              bucket31to60: { count: 1, totalCharge: 150 },
              bucket61Plus: { count: 0, totalCharge: 0 },
              totalOutstanding: 3,
            },
            operational: { unresolvedClaims: 3, eraUnpostedCount: 0, eraUnmatchedCount: 1, authIssuesOpen: 0 },
            payerPerformance: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  });
});

beforeEach(() => {
  state.emailCalls = [];
  state.reportFetchCalls = [];
  state.reportResponse = null;
  state.guardOverride = null;
  state.emailResult = { ok: true, providerId: "rsnd-1", fromEmail: "billing@from.test" };
});

async function loadPost() {
  const mod = await import("../send/route");
  return mod.POST as (r: Request) => Promise<Response>;
}

test("rejects when no recipients are supplied", async () => {
  const POST = await loadPost();
  const res = await POST(jsonRequest({ organizationId: ORG, month: "2026-04", recipients: [] }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.match(body.error, /at least one recipient/i);
  assert.equal(state.emailCalls.length, 0);
  assert.equal(state.reportFetchCalls.length, 0);
});

test("rejects malformed addresses with the offending value in the error", async () => {
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({ organizationId: ORG, month: "2026-04", recipients: "ok@x.com, not-an-email" }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { success: boolean; error: string };
  assert.match(body.error, /not-an-email/);
  assert.equal(state.emailCalls.length, 0);
});

test("caps recipient list at 10 to prevent fan-out abuse", async () => {
  const tooMany = Array.from({ length: 11 }, (_, i) => `r${i}@x.com`);
  const POST = await loadPost();
  const res = await POST(jsonRequest({ organizationId: ORG, month: "2026-04", recipients: tooMany }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /10/);
});

test("dedupes recipients case-insensitively before sending", async () => {
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({
      organizationId: ORG,
      month: "2026-04",
      recipients: "Owner@Example.com, owner@example.com, board@example.com",
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(state.emailCalls.length, 1);
  const call = state.emailCalls[0] as { to: string[] };
  assert.deepEqual(call.to, ["owner@example.com", "board@example.com"]);
});

test("forwards the caller's month + providerId scope to the report fetch", async () => {
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({
      organizationId: ORG,
      month: "2026-03",
      providerId: "prov-7",
      recipients: ["accountant@example.com"],
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(state.reportFetchCalls.length, 1);
  const url = state.reportFetchCalls[0].url;
  assert.match(url, /month=2026-03/);
  assert.match(url, /providerId=prov-7/);
  assert.match(url, new RegExp(`organizationId=${ORG}`));
});

test("renders the practice name + formatted month into the email subject context", async () => {
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({
      organizationId: ORG,
      month: "2026-04",
      recipients: ["accountant@example.com"],
      note: "  Heads up — Q1 close.  ",
    }),
  );
  assert.equal(res.status, 200);
  const call = state.emailCalls[0] as {
    practiceName: string;
    monthLabel: string;
    scopeLabel: string;
    note: string | null;
    senderName: string | null;
    reportUrl: string;
    htmlSnapshot: string;
    textSnapshot: string;
  };
  assert.equal(call.practiceName, "Sunrise Therapy Group");
  assert.equal(call.monthLabel, "April 2026");
  assert.equal(call.scopeLabel, "Practice (all clinicians)");
  assert.equal(call.note, "Heads up — Q1 close.");
  assert.equal(call.senderName, "Riley Owner");
  assert.match(call.reportUrl, /\/billing\/reports\?organizationId=/);
  // The link must carry the month so recipients land on the same period
  // as the snapshot they received.
  assert.match(call.reportUrl, /month=2026-04/);
  // Snapshot body must include the numbers the page shows.
  assert.match(call.textSnapshot, /Claims Submitted:\s+12/);
  assert.match(call.htmlSnapshot, /Executive Snapshot/);
  assert.match(call.htmlSnapshot, /\$3,200/);
});

test("a Resend rejection bubbles up as a 502 with the provider error", async () => {
  state.emailResult = { ok: false, error: "Mailbox bounced" };
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({
      organizationId: ORG,
      month: "2026-04",
      recipients: ["accountant@example.com"],
    }),
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Mailbox bounced/);
});

test("guard failure short-circuits before any email or report fetch", async () => {
  const { NextResponse } = await import("next/server");
  state.guardOverride = () =>
    NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({ organizationId: ORG, month: "2026-04", recipients: ["a@b.com"] }),
  );
  assert.equal(res.status, 401);
  assert.equal(state.emailCalls.length, 0);
  assert.equal(state.reportFetchCalls.length, 0);
});

test("if the upstream report fails, returns 500 without sending email", async () => {
  state.reportResponse = new Response(
    JSON.stringify({ success: false, error: "DB down" }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
  const POST = await loadPost();
  const res = await POST(
    jsonRequest({ organizationId: ORG, month: "2026-04", recipients: ["a@b.com"] }),
  );
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /DB down/);
  assert.equal(state.emailCalls.length, 0);
});
