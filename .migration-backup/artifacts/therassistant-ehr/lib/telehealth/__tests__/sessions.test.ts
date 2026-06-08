/**
 * Tests for the booking-time meeting auto-create and reschedule sync
 * helpers (Task #155). These exercise the branching that the create
 * route and PATCH route rely on without hitting Zoom/Google APIs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ensureMeetingForAppointment,
  syncMeetingForAppointment,
  type AppointmentForMeeting,
} from "../sessions";

const ORG = "org-1";
const APPT_ID = "appt-1";
const PROVIDER_ID = "prov-1";
const STAFF_ID = "staff-1";
const AUTH_USER_ID = "auth-1";

type Row = Record<string, any>;

type FakeOpts = {
  providerProfile?: Row | null;
  staffRow?: Row | null;
  connectionRow?: Row | null;
  tokenRow?: Row | null;
  initialSessions?: Row[];
};

function makeFakeSupabase(opts: FakeOpts = {}) {
  const sessions: Row[] = [...(opts.initialSessions ?? [])];
  const updatedSessions: Array<{ id: string; patch: Row }> = [];
  const connectionUpdates: Array<{ id: string; patch: Row }> = [];
  const tokenUpdates: Array<{ id: string; patch: Row }> = [];
  let nextSession = sessions.length + 1;

  function builder(table: string) {
    const state: {
      op: "select" | "insert" | "update" | "delete" | "upsert";
      filters: Array<[string, unknown]>;
      isNull: Array<string>;
      data?: Row;
      orderBy?: string;
      limit?: number;
    } = { op: "select", filters: [], isNull: [] };

    const chain: any = {};
    const ret = () => chain;
    chain.select = () => { state.op = state.op === "select" ? "select" : state.op; return chain; };
    chain.insert = (row: Row) => { state.op = "insert"; state.data = row; return chain; };
    chain.update = (row: Row) => { state.op = "update"; state.data = row; return chain; };
    chain.delete = () => { state.op = "delete"; return chain; };
    chain.upsert = (row: Row) => { state.op = "upsert"; state.data = row; return chain; };
    chain.eq = (f: string, v: unknown) => { state.filters.push([f, v]); return chain; };
    chain.in = (f: string, vs: unknown[]) => { state.filters.push([f, vs]); return chain; };
    chain.is = (f: string, _v: unknown) => { state.isNull.push(f); return chain; };
    chain.order = (f: string) => { state.orderBy = f; return chain; };
    chain.limit = (n: number) => { state.limit = n; return chain; };

    function match(row: Row): boolean {
      for (const [f, v] of state.filters) {
        if (Array.isArray(v)) {
          if (!v.includes(row[f])) return false;
        } else if (row[f] !== v) {
          return false;
        }
      }
      for (const f of state.isNull) {
        if (row[f] !== null && row[f] !== undefined) return false;
      }
      return true;
    }

    function exec(): { data: any; error: any } {
      if (table === "provider_credentialing_profiles") {
        const row = opts.providerProfile ?? null;
        if (row && match(row)) return { data: row, error: null };
        return { data: null, error: null };
      }
      if (table === "staff_profiles") {
        const row = opts.staffRow ?? null;
        if (row && match(row)) return { data: row, error: null };
        return { data: null, error: null };
      }
      if (table === "integration_connections") {
        const row = opts.connectionRow ?? null;
        if (state.op === "update") {
          if (row && match(row)) connectionUpdates.push({ id: row.id, patch: state.data! });
          return { data: null, error: null };
        }
        if (row && match(row)) return { data: row, error: null };
        return { data: null, error: null };
      }
      if (table === "telehealth_oauth_tokens") {
        const row = opts.tokenRow ?? null;
        if (state.op === "update") {
          if (row && match(row)) tokenUpdates.push({ id: row.integration_connection_id, patch: state.data! });
          return { data: null, error: null };
        }
        if (row && match(row)) return { data: row, error: null };
        return { data: null, error: null };
      }
      if (table === "telehealth_sessions") {
        if (state.op === "insert") {
          const id = `sess-${nextSession++}`;
          const inserted = { id, archived_at: null, ...state.data, created_at: new Date().toISOString() };
          sessions.push(inserted);
          return { data: { id }, error: null };
        }
        if (state.op === "update") {
          const matched = sessions.filter(match);
          for (const r of matched) {
            updatedSessions.push({ id: r.id, patch: state.data! });
            Object.assign(r, state.data);
          }
          return { data: null, error: null };
        }
        const matched = sessions
          .filter(match)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return { data: matched[0] ?? null, error: null };
      }
      return { data: null, error: null };
    }

    chain.maybeSingle = async () => exec();
    chain.single = async () => exec();
    // Some call sites use `.then` via await on the builder itself.
    chain.then = (resolve: (v: any) => void) => resolve(exec());
    return chain;
  }

  return {
    supabase: { from: (t: string) => builder(t) } as any,
    sessions,
    updatedSessions,
    connectionUpdates,
    tokenUpdates,
  };
}

const APPT: AppointmentForMeeting = {
  id: APPT_ID,
  organizationId: ORG,
  providerId: PROVIDER_ID,
  scheduledStartAt: "2026-06-01T15:00:00.000Z",
  scheduledEndAt: "2026-06-01T16:00:00.000Z",
  appointmentType: "Therapy",
  telehealthUrl: "https://legacy.example/foo",
};

function withZoomFetch<T>(handler: (url: string, init?: RequestInit) => any, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string, init?: RequestInit) => {
    const res = handler(url, init);
    return res;
  };
  return fn().finally(() => {
    (global as any).fetch = original;
  });
}

// Token encryption helper exercises the real crypto, so set the key once.
process.env.TELEHEALTH_TOKEN_ENC_KEY ??= "test-key-1234567890abcdef-extra-bytes-long";

async function importCrypto() {
  return await import("../crypto");
}

test("ensureMeetingForAppointment: skipped when provider has no default platform", async () => {
  const { supabase } = makeFakeSupabase({
    providerProfile: {
      id: PROVIDER_ID,
      organization_id: ORG,
      default_telehealth_platform: null,
      telehealth_url: "https://legacy.example/foo",
      staff_id: STAFF_ID,
    },
  });
  const outcome = await ensureMeetingForAppointment(supabase, APPT);
  assert.equal(outcome.status, "skipped");
});

test("ensureMeetingForAppointment: fallback when provider has platform but no connection", async () => {
  const { supabase } = makeFakeSupabase({
    providerProfile: {
      id: PROVIDER_ID,
      organization_id: ORG,
      default_telehealth_platform: "zoom",
      telehealth_url: "https://legacy.example/foo",
      staff_id: STAFF_ID,
    },
    staffRow: { id: STAFF_ID, auth_user_id: AUTH_USER_ID },
    connectionRow: null,
  });
  const outcome = await ensureMeetingForAppointment(supabase, APPT);
  assert.equal(outcome.status, "fallback");
  if (outcome.status === "fallback") {
    assert.equal(outcome.platform, "zoom");
    assert.equal(outcome.joinUrl, "https://legacy.example/foo");
  }
});

test("ensureMeetingForAppointment: creates Zoom meeting and persists session", async () => {
  const { encryptToken } = await importCrypto();
  const { supabase, sessions } = makeFakeSupabase({
    providerProfile: {
      id: PROVIDER_ID,
      organization_id: ORG,
      default_telehealth_platform: "zoom",
      telehealth_url: null,
      staff_id: STAFF_ID,
    },
    staffRow: { id: STAFF_ID, auth_user_id: AUTH_USER_ID },
    connectionRow: {
      id: "conn-1",
      organization_id: ORG,
      owner_user_id: AUTH_USER_ID,
      integration_type: "zoom",
      connection_status: "active",
      external_account_email: "doc@example.com",
    },
    tokenRow: {
      integration_connection_id: "conn-1",
      access_token_enc: encryptToken("zoom-access-token"),
      refresh_token_enc: encryptToken("zoom-refresh-token"),
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      account_email: "doc@example.com",
    },
  });

  const outcome = await withZoomFetch(
    () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 12345, join_url: "https://zoom.us/j/12345", start_url: "https://zoom.us/s/12345?host=true" }),
      text: async () => "",
    }),
    () => ensureMeetingForAppointment(supabase, APPT),
  );

  assert.equal(outcome.status, "created");
  if (outcome.status === "created") {
    assert.equal(outcome.platform, "zoom");
    assert.equal(outcome.joinUrl, "https://zoom.us/j/12345");
    assert.equal(outcome.hostUrl, "https://zoom.us/s/12345?host=true");
    assert.equal(outcome.externalMeetingId, "12345");
  }
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].telehealth_vendor, "zoom");
  assert.equal(sessions[0].meeting_url, "https://zoom.us/j/12345");
});

test("ensureMeetingForAppointment: reuses existing session and skips API call", async () => {
  const { supabase } = makeFakeSupabase({
    initialSessions: [
      {
        id: "sess-prev",
        organization_id: ORG,
        appointment_id: APPT_ID,
        archived_at: null,
        meeting_url: "https://zoom.us/j/old",
        host_url: null,
        telehealth_vendor: "zoom",
        external_meeting_id: "old-id",
        created_at: "2026-05-01T00:00:00.000Z",
      },
    ],
  });
  let fetchCalled = false;
  const outcome = await withZoomFetch(
    () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    },
    () => ensureMeetingForAppointment(supabase, APPT),
  );
  assert.equal(fetchCalled, false);
  assert.equal(outcome.status, "existing");
  if (outcome.status === "existing") {
    assert.equal(outcome.joinUrl, "https://zoom.us/j/old");
  }
});

test("syncMeetingForAppointment: updates the existing Zoom meeting in place", async () => {
  const { encryptToken } = await importCrypto();
  const { supabase, sessions, updatedSessions } = makeFakeSupabase({
    providerProfile: {
      id: PROVIDER_ID,
      organization_id: ORG,
      default_telehealth_platform: "zoom",
      telehealth_url: null,
      staff_id: STAFF_ID,
    },
    staffRow: { id: STAFF_ID, auth_user_id: AUTH_USER_ID },
    connectionRow: {
      id: "conn-1",
      organization_id: ORG,
      owner_user_id: AUTH_USER_ID,
      integration_type: "zoom",
      connection_status: "active",
      external_account_email: "doc@example.com",
    },
    tokenRow: {
      integration_connection_id: "conn-1",
      access_token_enc: encryptToken("zoom-access-token"),
      refresh_token_enc: null,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      account_email: "doc@example.com",
    },
    initialSessions: [
      {
        id: "sess-prev",
        organization_id: ORG,
        appointment_id: APPT_ID,
        archived_at: null,
        meeting_url: "https://zoom.us/j/12345",
        host_url: "https://zoom.us/s/12345?host=true",
        telehealth_vendor: "zoom",
        external_meeting_id: "12345",
        scheduled_start_at: APPT.scheduledStartAt,
        created_at: "2026-05-01T00:00:00.000Z",
      },
    ],
  });

  const calls: Array<{ url: string; method: string }> = [];
  const outcome = await withZoomFetch(
    (url, init) => {
      calls.push({ url: String(url), method: String(init?.method ?? "GET") });
      // First call is PATCH (204), second is the re-GET.
      if ((init?.method ?? "GET") === "PATCH") {
        return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 12345, join_url: "https://zoom.us/j/12345", start_url: "https://zoom.us/s/12345?host=true" }),
        text: async () => "",
      };
    },
    () =>
      syncMeetingForAppointment(supabase, {
        ...APPT,
        scheduledStartAt: "2026-06-08T15:00:00.000Z",
        scheduledEndAt: "2026-06-08T16:00:00.000Z",
      }),
  );

  assert.equal(outcome.status, "updated");
  assert.ok(calls.some((c) => c.method === "PATCH"), "expected PATCH to Zoom meetings endpoint");
  assert.equal(sessions.length, 1, "should not create a new session");
  assert.ok(updatedSessions.length >= 1, "should write new scheduled_start_at on session");
  const patched = updatedSessions.find((u) => u.patch.scheduled_start_at);
  assert.equal(patched?.patch.scheduled_start_at, "2026-06-08T15:00:00.000Z");
});

test("syncMeetingForAppointment: no_session when nothing was ever booked", async () => {
  const { supabase } = makeFakeSupabase();
  const outcome = await syncMeetingForAppointment(supabase, APPT);
  assert.equal(outcome.status, "no_session");
});
