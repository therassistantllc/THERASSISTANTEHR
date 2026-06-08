/**
 * End-to-end Telehealth Connect + Join smoke (Task #154).
 *
 * The real Connect / Join flow goes through real Zoom and Google OAuth and
 * cannot be hit from CI without live credentials. This suite drives the
 * actual route handlers and library code against:
 *
 *   - an in-memory supabase fake (integration_connections,
 *     telehealth_oauth_tokens, telehealth_sessions, appointments,
 *     provider_credentialing_profiles, staff_profiles)
 *   - a mocked global fetch that pretends to be Zoom / Google OAuth +
 *     userinfo + meeting-creation APIs.
 *
 * It pins the cases the original task description called out:
 *
 *   1. Connect Zoom + Connect Google Meet — an encrypted token row lands in
 *      telehealth_oauth_tokens AND an integration_connections row is upserted
 *      with the correct owner_user_id / integration_type.
 *   2. POST /api/telehealth/appointments/:id/join for an appointment whose
 *      provider is the connected clinician → real telehealth_sessions row
 *      with a fresh meeting URL coming back from the adapter.
 *   3. Force a token expiry and assert loadAuthForProvider refreshes
 *      silently (calls the refresh_token grant, persists the new access
 *      token + expires_at, leaves connection_status active).
 *   4. Wrong-clinician Join — the JOIN call uses the provider's connected
 *      account, not the caller's, and only the provider receives host_url.
 *   5. Disconnect path — telehealth_oauth_tokens row and the
 *      integration_connections row are both gone afterward.
 *
 * The whole thing runs offline; once real Zoom/Google sandbox credentials
 * land in the project, swapping the fetch mock for `undici`'s real client
 * upgrades this into a true integration smoke without changing assertions.
 */

import { strict as assert } from "node:assert";
import { before, beforeEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Env required by config/crypto/oauthState. Set BEFORE any route import.
// ---------------------------------------------------------------------------
process.env.TELEHEALTH_TOKEN_ENC_KEY =
  process.env.TELEHEALTH_TOKEN_ENC_KEY ?? "test-telehealth-enc-key-aaaaaaaaaaaa";
process.env.TELEHEALTH_OAUTH_STATE_SECRET =
  process.env.TELEHEALTH_OAUTH_STATE_SECRET ?? "test-state-secret-zzzzzzzzzzzz";
process.env.ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID ?? "zoom-client-id";
process.env.ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET ?? "zoom-client-secret";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "google-client-id";
process.env.GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ?? "google-client-secret";

const ORG = "org-zzz";
const CLINICIAN_USER = "user-clinician-1";
const CLINICIAN_STAFF = "staff-clinician-1";
const PROVIDER_PROFILE = "prof-clinician-1";
const OTHER_USER = "user-other-1";
const OTHER_STAFF = "staff-other-1";

// ---------------------------------------------------------------------------
// In-memory supabase fake. Just enough of the chainable surface that the
// route + lib code we exercise needs.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
type Filter =
  | { op: "eq"; field: string; value: unknown }
  | { op: "in"; field: string; values: unknown[] }
  | { op: "is"; field: string; value: unknown };

class QB {
  filters: Filter[] = [];
  op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  payload: any = null;
  conflict: string | null = null;
  constructor(private tables: Record<string, Row[]>, private table: string) {
    if (!tables[table]) tables[table] = [];
  }
  select(_cols?: string) {
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push({ op: "eq", field, value });
    return this;
  }
  in(field: string, values: unknown[]) {
    this.filters.push({ op: "in", field, values });
    return this;
  }
  is(field: string, value: unknown) {
    this.filters.push({ op: "is", field, value });
    return this;
  }
  order(_f?: string, _opts?: unknown) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  insert(row: any) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: any) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  upsert(row: any, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = row;
    this.conflict = opts?.onConflict ?? null;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private match(rows: Row[]): Row[] {
    return rows.filter((r) =>
      this.filters.every((f) => {
        if (f.op === "eq") return r[f.field] === f.value;
        if (f.op === "in") return f.values.includes(r[f.field]);
        // is null / is not null
        if (f.value === null)
          return r[f.field] === null || r[f.field] === undefined;
        return r[f.field] === f.value;
      }),
    );
  }
  private exec(): { data: Row[] | null; error: any } {
    const arr = this.tables[this.table];
    if (this.op === "select") return { data: this.match(arr), error: null };
    if (this.op === "insert") {
      const row = {
        ...this.payload,
        id: this.payload.id ?? `${this.table}-${arr.length + 1}`,
      };
      arr.push(row);
      return { data: [row], error: null };
    }
    if (this.op === "upsert") {
      if (this.conflict && this.payload[this.conflict] !== undefined) {
        const idx = arr.findIndex(
          (r) => r[this.conflict!] === this.payload[this.conflict!],
        );
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], ...this.payload };
          return { data: [arr[idx]], error: null };
        }
      }
      const row = {
        ...this.payload,
        id: this.payload.id ?? `${this.table}-${arr.length + 1}`,
      };
      arr.push(row);
      return { data: [row], error: null };
    }
    if (this.op === "update") {
      const m = this.match(arr);
      for (const r of m) Object.assign(r, this.payload);
      return { data: m, error: null };
    }
    if (this.op === "delete") {
      const m = this.match(arr);
      for (const r of m) arr.splice(arr.indexOf(r), 1);
      return { data: m, error: null };
    }
    return { data: null, error: null };
  }
  async maybeSingle() {
    const r = this.exec();
    return { data: r.data && r.data.length ? r.data[0] : null, error: r.error };
  }
  async single() {
    const r = this.exec();
    return { data: r.data && r.data.length ? r.data[0] : null, error: r.error };
  }
  then(resolve: (v: { data: any; error: any }) => any, reject: (e: any) => any) {
    try {
      return Promise.resolve(this.exec()).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}

const TABLES: Record<string, Row[]> = {};
function resetTables() {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  TABLES.integration_connections = [];
  TABLES.telehealth_oauth_tokens = [];
  TABLES.telehealth_sessions = [];
  TABLES.appointments = [];
  TABLES.provider_credentialing_profiles = [];
  TABLES.staff_profiles = [];
}

const fakeSupabase = {
  from(table: string) {
    return new QB(TABLES, table);
  },
};

// ---------------------------------------------------------------------------
// Fetch mock. Captures the requests so the refresh-grant case can assert
// that loadAuthForProvider actually swung by the OAuth token endpoint.
// ---------------------------------------------------------------------------
type FetchCall = { url: string; init: RequestInit | undefined };
const fetchCalls: FetchCall[] = [];

type FetchHandler = (url: string, init: RequestInit | undefined) => Response | null;
const fetchHandlers: FetchHandler[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock() {
  (globalThis as any).fetch = async (
    input: any,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    fetchCalls.push({ url, init });
    for (const h of fetchHandlers) {
      const r = h(url, init);
      if (r) return r;
    }
    return jsonResponse({ error: "unhandled fetch", url }, 500);
  };
}

function defaultFetchHandlers(): FetchHandler[] {
  return [
    // ---- Zoom token endpoint ------------------------------------------------
    (url, init) => {
      if (!url.startsWith("https://zoom.us/oauth/token")) return null;
      const body = String((init?.body as URLSearchParams) ?? "");
      const grant = new URLSearchParams(body).get("grant_type");
      if (grant === "refresh_token") {
        return jsonResponse({
          access_token: "zoom-access-refreshed",
          expires_in: 3600,
        });
      }
      return jsonResponse({
        access_token: "zoom-access-1",
        refresh_token: "zoom-refresh-1",
        expires_in: 3600,
        scope: "meeting:write:meeting",
      });
    },
    // ---- Google token endpoint ---------------------------------------------
    (url, init) => {
      if (!url.startsWith("https://oauth2.googleapis.com/token")) return null;
      const body = String((init?.body as URLSearchParams) ?? "");
      const grant = new URLSearchParams(body).get("grant_type");
      if (grant === "refresh_token") {
        return jsonResponse({
          access_token: "google-access-refreshed",
          expires_in: 3600,
        });
      }
      return jsonResponse({
        access_token: "google-access-1",
        refresh_token: "google-refresh-1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.events",
      });
    },
    // ---- Zoom /users/me userinfo -------------------------------------------
    (url) => {
      if (url !== "https://api.zoom.us/v2/users/me") return null;
      return jsonResponse({ email: "doc@example.com" });
    },
    // ---- Google userinfo ---------------------------------------------------
    (url) => {
      if (url !== "https://www.googleapis.com/oauth2/v3/userinfo") return null;
      return jsonResponse({ email: "doc@example.com" });
    },
    // ---- Zoom create meeting -----------------------------------------------
    (url) => {
      if (url !== "https://api.zoom.us/v2/users/me/meetings") return null;
      return jsonResponse(
        {
          id: 9876543210,
          join_url: "https://zoom.us/j/9876543210?pwd=abc",
          start_url: "https://zoom.us/s/9876543210?zak=hostkey",
        },
        201,
      );
    },
    // ---- Google Calendar create event --------------------------------------
    (url) => {
      if (!url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events"))
        return null;
      return jsonResponse(
        {
          id: "evt-google-1",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          conferenceData: {
            entryPoints: [
              { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
            ],
          },
        },
        200,
      );
    },
  ];
}

// ---------------------------------------------------------------------------
// Auth mock. Lets us flip the caller between the connected clinician and a
// different staff member to exercise the wrong-clinician Join path.
// ---------------------------------------------------------------------------
type Session = { userId: string; staffId: string; email: string | null };
const session: { current: Session } = {
  current: { userId: CLINICIAN_USER, staffId: CLINICIAN_STAFF, email: "doc@example.com" },
};

before(() => {
  installFetchMock();

  mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseAdminClient: () => fakeSupabase,
    },
  });

  mock.module("@/lib/rbac/auth", {
    namedExports: {
      requireAuthenticatedStaff: async () => ({
        userId: session.current.userId,
        staffId: session.current.staffId,
        organizationId: ORG,
        email: session.current.email,
        firstName: null,
        lastName: null,
        jobTitle: null,
        isActive: true,
        roles: [],
        permissions: [],
      }),
    },
  });
});

beforeEach(() => {
  resetTables();
  fetchCalls.length = 0;
  fetchHandlers.length = 0;
  for (const h of defaultFetchHandlers()) fetchHandlers.push(h);
  session.current = {
    userId: CLINICIAN_USER,
    staffId: CLINICIAN_STAFF,
    email: "doc@example.com",
  };
  // Seed: provider profile owned by CLINICIAN_USER with Zoom as the default
  // platform. Adjust per-test as needed.
  TABLES.staff_profiles.push({
    id: CLINICIAN_STAFF,
    auth_user_id: CLINICIAN_USER,
  });
  TABLES.staff_profiles.push({
    id: OTHER_STAFF,
    auth_user_id: OTHER_USER,
  });
  TABLES.provider_credentialing_profiles.push({
    id: PROVIDER_PROFILE,
    organization_id: ORG,
    staff_id: CLINICIAN_STAFF,
    default_telehealth_platform: "zoom",
    telehealth_url: null,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runOAuthCallback(platform: "zoom" | "google_meet"): Promise<Response> {
  const { signOAuthState } = await import("../oauthState");
  const { GET } = await import(
    `../../../app/api/telehealth/oauth/[platform]/callback/route`
  );
  const state = signOAuthState({
    u: CLINICIAN_USER,
    o: ORG,
    p: platform,
    pid: PROVIDER_PROFILE,
  });
  const url = `https://app.test/api/telehealth/oauth/${platform}/callback?code=auth-code&state=${encodeURIComponent(state)}`;
  return GET(new Request(url), {
    params: Promise.resolve({ platform }),
  });
}

async function runDisconnect(platform: "zoom" | "google_meet"): Promise<Response> {
  const { POST } = await import(
    `../../../app/api/telehealth/oauth/[platform]/disconnect/route`
  );
  return POST(new Request("https://app.test/x", { method: "POST" }), {
    params: Promise.resolve({ platform }),
  });
}

async function runJoin(appointmentId: string): Promise<Response> {
  const { POST } = await import(
    `../../../app/api/telehealth/appointments/[id]/join/route`
  );
  return POST(new Request(`https://app.test/x/${appointmentId}/join`, { method: "POST" }), {
    params: Promise.resolve({ id: appointmentId }),
  });
}

function seedAppointment(opts?: { providerId?: string | null; id?: string }) {
  const id = opts?.id ?? "appt-1";
  TABLES.appointments.push({
    id,
    organization_id: ORG,
    provider_id: opts?.providerId === undefined ? PROVIDER_PROFILE : opts.providerId,
    scheduled_start_at: "2026-06-01T16:00:00Z",
    scheduled_end_at: "2026-06-01T16:50:00Z",
    appointment_type: "Telehealth follow-up",
    telehealth_url: null,
    service_location: null,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Telehealth Connect callback (Zoom + Google Meet)", () => {
  it("Zoom: stores an encrypted token row and an active integration_connections row scoped to the clinician", async () => {
    const res = await runOAuthCallback("zoom");
    assert.equal(res.status, 302, "callback should redirect to settings on success");
    assert.match(res.headers.get("location") ?? "", /telehealth_connected=zoom/);

    assert.equal(TABLES.integration_connections.length, 1);
    const conn = TABLES.integration_connections[0];
    assert.equal(conn.organization_id, ORG);
    assert.equal(conn.owner_user_id, CLINICIAN_USER);
    assert.equal(conn.integration_type, "zoom");
    assert.equal(conn.connection_status, "active");
    assert.equal(conn.external_account_email, "doc@example.com");

    assert.equal(TABLES.telehealth_oauth_tokens.length, 1);
    const tok = TABLES.telehealth_oauth_tokens[0];
    assert.equal(tok.integration_connection_id, conn.id);
    assert.equal(tok.platform, "zoom");
    // Tokens are encrypted at rest: never the raw OAuth string.
    assert.notEqual(tok.access_token_enc, "zoom-access-1");
    assert.notEqual(tok.refresh_token_enc, "zoom-refresh-1");
    assert.match(String(tok.access_token_enc), /^v1:/);
    assert.match(String(tok.refresh_token_enc), /^v1:/);

    // And the encrypted blob really does decrypt back to the OAuth token.
    const { decryptToken } = await import("../crypto");
    assert.equal(decryptToken(tok.access_token_enc), "zoom-access-1");
    assert.equal(decryptToken(tok.refresh_token_enc), "zoom-refresh-1");
  });

  it("Google Meet: stores an encrypted token row and an active integration_connections row scoped to the clinician", async () => {
    const res = await runOAuthCallback("google_meet");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /telehealth_connected=google_meet/);

    const conn = TABLES.integration_connections.find(
      (c) => c.integration_type === "google_meet",
    );
    assert.ok(conn, "expected a google_meet integration_connections row");
    assert.equal(conn!.owner_user_id, CLINICIAN_USER);
    assert.equal(conn!.connection_status, "active");

    const tok = TABLES.telehealth_oauth_tokens.find((t) => t.platform === "google_meet");
    assert.ok(tok);
    const { decryptToken } = await import("../crypto");
    assert.equal(decryptToken(tok!.access_token_enc), "google-access-1");
    assert.equal(decryptToken(tok!.refresh_token_enc), "google-refresh-1");
  });

  it("rejects a tampered state (wrong signature) without writing anything", async () => {
    // Hand-build a state with a bogus signature.
    const badState = Buffer.from(
      JSON.stringify({
        u: CLINICIAN_USER,
        o: ORG,
        p: "zoom",
        pid: null,
        n: "x",
        e: Math.floor(Date.now() / 1000) + 600,
      }),
    )
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const { GET } = await import(
      "../../../app/api/telehealth/oauth/[platform]/callback/route"
    );
    const res = await GET(
      new Request(
        `https://app.test/api/telehealth/oauth/zoom/callback?code=c&state=${badState}.deadbeef`,
      ),
      { params: Promise.resolve({ platform: "zoom" }) },
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /telehealth_error=invalid_state/);
    assert.equal(TABLES.integration_connections.length, 0);
    assert.equal(TABLES.telehealth_oauth_tokens.length, 0);
  });
});

describe("POST /api/telehealth/appointments/:id/join — happy path", () => {
  it("creates a fresh telehealth_sessions row using the provider's connected account", async () => {
    await runOAuthCallback("zoom");
    const apptId = seedAppointment();

    const res = await runJoin(apptId);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      source: string;
      platform: string;
      joinUrl: string;
      hostUrl: string | null;
      sessionId: string | null;
    };
    assert.equal(body.success, true);
    assert.equal(body.source, "created");
    assert.equal(body.platform, "zoom");
    assert.equal(body.joinUrl, "https://zoom.us/j/9876543210?pwd=abc");
    // Caller IS the provider here, so host_url is returned.
    assert.equal(body.hostUrl, "https://zoom.us/s/9876543210?zak=hostkey");

    // A real telehealth_sessions row landed and points at the appointment.
    assert.equal(TABLES.telehealth_sessions.length, 1);
    const sess = TABLES.telehealth_sessions[0];
    assert.equal(sess.appointment_id, apptId);
    assert.equal(sess.organization_id, ORG);
    assert.equal(sess.telehealth_vendor, "zoom");
    assert.equal(sess.meeting_url, "https://zoom.us/j/9876543210?pwd=abc");
    assert.equal(sess.host_url, "https://zoom.us/s/9876543210?zak=hostkey");
  });

  it("repeat Join reuses the existing session row (no second meeting created)", async () => {
    await runOAuthCallback("zoom");
    const apptId = seedAppointment();
    await runJoin(apptId);
    const createCallsBefore = fetchCalls.filter(
      (c) => c.url === "https://api.zoom.us/v2/users/me/meetings",
    ).length;
    assert.equal(createCallsBefore, 1);

    const res2 = await runJoin(apptId);
    const body2 = (await res2.json()) as { source: string; joinUrl: string };
    assert.equal(body2.source, "existing_session");
    assert.equal(body2.joinUrl, "https://zoom.us/j/9876543210?pwd=abc");
    assert.equal(TABLES.telehealth_sessions.length, 1, "should not double-create sessions");
    const createCallsAfter = fetchCalls.filter(
      (c) => c.url === "https://api.zoom.us/v2/users/me/meetings",
    ).length;
    assert.equal(createCallsAfter, 1, "Zoom create-meeting should not be re-hit");
  });
});

describe("loadAuthForProvider silent refresh on expiry", () => {
  it("calls the OAuth refresh grant and persists a new access token / expires_at", async () => {
    await runOAuthCallback("zoom");
    // Force the stored token to look expired.
    const tok = TABLES.telehealth_oauth_tokens[0];
    tok.expires_at = new Date(Date.now() - 60_000).toISOString();
    const beforeRefresh = tok.access_token_enc;

    const { loadAuthForProvider } = await import("../connections");
    const auth = await loadAuthForProvider(fakeSupabase as any, {
      organizationId: ORG,
      ownerUserId: CLINICIAN_USER,
      platform: "zoom",
    });
    assert.ok(auth, "expected refreshed auth, not null");
    assert.equal(auth!.accessToken, "zoom-access-refreshed");

    // Token row updated in place with the refreshed ciphertext + new expiry.
    const after = TABLES.telehealth_oauth_tokens[0];
    assert.notEqual(after.access_token_enc, beforeRefresh, "ciphertext must rotate");
    const { decryptToken } = await import("../crypto");
    assert.equal(decryptToken(after.access_token_enc), "zoom-access-refreshed");
    assert.ok(
      after.expires_at && new Date(after.expires_at).getTime() > Date.now(),
      "expires_at must be in the future after refresh",
    );
    assert.equal(after.last_error, null);

    // Connection stays active (no needs_reconnect bounce on a clean refresh).
    const conn = TABLES.integration_connections[0];
    assert.equal(conn.connection_status, "active");

    // Refresh-grant POST actually went out.
    const refreshHit = fetchCalls.find(
      (c) =>
        c.url.startsWith("https://zoom.us/oauth/token") &&
        String((c.init?.body as URLSearchParams) ?? "").includes("grant_type=refresh_token"),
    );
    assert.ok(refreshHit, "expected a refresh_token grant fetch to Zoom");
  });

  it("marks connection needs_reconnect and returns null when the refresh grant fails", async () => {
    await runOAuthCallback("zoom");
    const tok = TABLES.telehealth_oauth_tokens[0];
    tok.expires_at = new Date(Date.now() - 60_000).toISOString();

    // Swap the Zoom token handler with one that 401s the refresh.
    fetchHandlers.length = 0;
    for (const h of defaultFetchHandlers()) fetchHandlers.push(h);
    fetchHandlers.unshift((url, init) => {
      if (!url.startsWith("https://zoom.us/oauth/token")) return null;
      const body = String((init?.body as URLSearchParams) ?? "");
      if (body.includes("grant_type=refresh_token")) {
        return jsonResponse({ error: "invalid_grant" }, 400);
      }
      return null;
    });

    const { loadAuthForProvider } = await import("../connections");
    const auth = await loadAuthForProvider(fakeSupabase as any, {
      organizationId: ORG,
      ownerUserId: CLINICIAN_USER,
      platform: "zoom",
    });
    assert.equal(auth, null);
    assert.equal(TABLES.integration_connections[0].connection_status, "needs_reconnect");
    assert.match(
      String(TABLES.integration_connections[0].last_error ?? ""),
      /Token refresh failed/,
    );
  });
});

describe("Wrong clinician clicks Join", () => {
  it("uses the provider's connected account (not the caller's) and hides host_url from non-providers", async () => {
    // Provider clinician connects Zoom first.
    await runOAuthCallback("zoom");

    // Now a different staff member clicks Join.
    session.current = { userId: OTHER_USER, staffId: OTHER_STAFF, email: "other@example.com" };
    const apptId = seedAppointment();
    const res = await runJoin(apptId);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      platform: string;
      joinUrl: string;
      hostUrl: string | null;
    };
    assert.equal(body.success, true);
    assert.equal(body.platform, "zoom");
    assert.equal(body.joinUrl, "https://zoom.us/j/9876543210?pwd=abc");
    // Privileged host_url MUST be suppressed for non-provider callers.
    assert.equal(body.hostUrl, null);

    // And the bearer token sent to Zoom was the PROVIDER's access token,
    // not anything keyed to the caller (the caller has no Zoom connection).
    const createCall = fetchCalls.find(
      (c) => c.url === "https://api.zoom.us/v2/users/me/meetings",
    );
    assert.ok(createCall);
    const authHeader = String(
      (createCall!.init?.headers as Record<string, string>)?.Authorization ?? "",
    );
    assert.equal(authHeader, "Bearer zoom-access-1");
  });

  it("returns 409 requiresConnect when the provider has not connected at all", async () => {
    // No Connect was ever run. Caller is the provider.
    const apptId = seedAppointment();
    const res = await runJoin(apptId);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { requiresConnect: boolean; platform: string };
    assert.equal(body.requiresConnect, true);
    assert.equal(body.platform, "zoom");
    assert.equal(TABLES.telehealth_sessions.length, 0);
  });
});

describe("Disconnect path", () => {
  it("removes both the telehealth_oauth_tokens row and the integration_connections row", async () => {
    await runOAuthCallback("zoom");
    assert.equal(TABLES.integration_connections.length, 1);
    assert.equal(TABLES.telehealth_oauth_tokens.length, 1);

    const res = await runDisconnect("zoom");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean };
    assert.equal(body.success, true);

    assert.equal(TABLES.integration_connections.length, 0, "connection row should be gone");
    assert.equal(TABLES.telehealth_oauth_tokens.length, 0, "encrypted token row should be gone");
  });

  it("is idempotent (Disconnect when nothing is connected returns alreadyDisconnected)", async () => {
    const res = await runDisconnect("zoom");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      alreadyDisconnected?: boolean;
    };
    assert.equal(body.success, true);
    assert.equal(body.alreadyDisconnected, true);
  });
});

// ---------------------------------------------------------------------------
// Regression source-pins: cheap guards so future refactors can't silently
// strip a security-relevant branch in the live route handlers.
// ---------------------------------------------------------------------------
describe("regression: telehealth route wiring", () => {
  const callbackSrc = readFileSync(
    "app/api/telehealth/oauth/[platform]/callback/route.ts",
    "utf8",
  );
  const joinSrc = readFileSync(
    "app/api/telehealth/appointments/[id]/join/route.ts",
    "utf8",
  );
  // The credential-error / needs-reconnect branch was hoisted into the
  // shared booking-time helper (Task #155) so both the join route and
  // the create/PATCH routes go through the same path. Pin the helper
  // source instead of the route source for that assertion.
  const sessionsHelperSrc = readFileSync("lib/telehealth/sessions.ts", "utf8");
  const disconnectSrc = readFileSync(
    "app/api/telehealth/oauth/[platform]/disconnect/route.ts",
    "utf8",
  );

  it("callback verifies the OAuth state before exchanging the code", () => {
    assert.match(callbackSrc, /verifyOAuthState\(state\)/);
    assert.match(callbackSrc, /invalid_state/);
  });

  it("callback persists with upsertConnection (encryption + per-clinician scoping)", () => {
    assert.match(callbackSrc, /upsertConnection\(/);
  });

  it("join routes auth lookup through the provider's auth_user_id, not the caller", () => {
    // Provider resolution lives in the shared helper now; the route
    // delegates via resolveProviderTelehealthContext +
    // ensureMeetingForAppointment, and the helper does the
    // provider-table lookup itself (with caller as fallback only).
    assert.match(sessionsHelperSrc, /provider_credentialing_profiles/);
    assert.match(sessionsHelperSrc, /staff_profiles/);
    assert.match(sessionsHelperSrc, /providerAuthUserId\s*\?\?\s*[^;]*fallbackOwnerUserId/);
    assert.match(joinSrc, /resolveProviderTelehealthContext\(/);
    assert.match(joinSrc, /ensureMeetingForAppointment\(/);
  });

  it("join only returns host_url to the provider whose account is hosting", () => {
    assert.match(joinSrc, /callerIsProvider/);
    assert.match(joinSrc, /callerIsProvider\s*\?\s*outcome\.hostUrl\s*:\s*null/);
  });

  it("join marks the connection needs_reconnect on 401/invalid_grant from the adapter", () => {
    assert.match(sessionsHelperSrc, /markConnectionNeedsReconnect\(/);
    assert.match(sessionsHelperSrc, /401\|unauthor\|invalid\[_ \]grant\|expired\|revoked/);
  });

  it("disconnect goes through deleteConnection (tokens + connection row both removed)", () => {
    assert.match(disconnectSrc, /deleteConnection\(/);
  });
});
