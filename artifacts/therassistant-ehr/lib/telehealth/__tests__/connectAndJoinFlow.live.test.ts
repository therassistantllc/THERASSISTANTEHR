/**
 * LIVE telehealth smoke (Task #154 — credential-gated companion to the
 * offline `connectAndJoinFlow.test.ts`).
 *
 * Why this file exists
 * --------------------
 * The offline suite mocks every Zoom / Google HTTP call so it can run in
 * CI without secrets. That catches our own route + lib regressions but
 * cannot catch provider-side contract drift (e.g. Zoom rotating a field
 * name, Google tightening conferenceData behavior, a refresh grant
 * returning a different error shape). This file exercises the SAME code
 * paths against the real Zoom + Google sandbox endpoints whenever a
 * sandbox refresh token is provisioned in the environment, and skips
 * cleanly otherwise.
 *
 * Required env (any platform can be enabled independently):
 *   TELEHEALTH_E2E_LIVE=1                     (master switch)
 *   TELEHEALTH_TOKEN_ENC_KEY=<>=24 chars>    (already used everywhere else)
 *
 *   For Zoom:
 *     ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 *     ZOOM_SANDBOX_REFRESH_TOKEN             (a refresh_token obtained
 *                                              once via the sandbox OAuth
 *                                              consent flow)
 *   For Google Meet:
 *     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *     GOOGLE_SANDBOX_REFRESH_TOKEN
 *
 * What it asserts (per enabled platform)
 * --------------------------------------
 *   - The seeded encrypted connection survives a real refresh-token
 *     grant against the live OAuth token endpoint; loadAuthForProvider
 *     rotates the ciphertext and pushes expires_at into the future.
 *   - The adapter's createMeeting actually produces a real meeting URL
 *     from the provider's API, and a telehealth_sessions row is
 *     persisted with that URL.
 *   - Disconnect removes both the encrypted token row and the
 *     integration_connections row.
 *
 * Why a pre-provisioned refresh token (no browser consent in CI)
 * --------------------------------------------------------------
 * Real OAuth consent requires a human in front of a browser; that's not
 * automatable. The standard pattern for a CI smoke is: run the consent
 * flow once by hand against the provider's sandbox tenant, stash the
 * resulting refresh_token in CI secrets, and let the smoke seed it.
 * Everything downstream (refresh, meeting create, disconnect) is then
 * exactly the same code that production runs.
 */

import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";

const LIVE = process.env.TELEHEALTH_E2E_LIVE === "1";

process.env.TELEHEALTH_TOKEN_ENC_KEY =
  process.env.TELEHEALTH_TOKEN_ENC_KEY ?? "test-telehealth-enc-key-aaaaaaaaaaaa";

const ORG = "live-org-1";
const CLINICIAN_USER = "live-clinician-1";

// Minimal in-memory supabase fake (same shape as the offline suite, kept
// local so this file remains self-contained and skippable).
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
  select(_c?: string) { return this; }
  eq(f: string, v: unknown) { this.filters.push({ op: "eq", field: f, value: v }); return this; }
  in(f: string, v: unknown[]) { this.filters.push({ op: "in", field: f, values: v }); return this; }
  is(f: string, v: unknown) { this.filters.push({ op: "is", field: f, value: v }); return this; }
  order() { return this; }
  limit() { return this; }
  insert(r: any) { this.op = "insert"; this.payload = r; return this; }
  update(r: any) { this.op = "update"; this.payload = r; return this; }
  upsert(r: any, o?: { onConflict?: string }) {
    this.op = "upsert"; this.payload = r; this.conflict = o?.onConflict ?? null; return this;
  }
  delete() { this.op = "delete"; return this; }
  private match(rows: Row[]): Row[] {
    return rows.filter((r) =>
      this.filters.every((f) => {
        if (f.op === "eq") return r[f.field] === f.value;
        if (f.op === "in") return f.values.includes(r[f.field]);
        if (f.value === null) return r[f.field] === null || r[f.field] === undefined;
        return r[f.field] === f.value;
      }),
    );
  }
  private exec() {
    const arr = this.tables[this.table];
    if (this.op === "select") return { data: this.match(arr), error: null };
    if (this.op === "insert" || this.op === "upsert") {
      if (this.op === "upsert" && this.conflict && this.payload[this.conflict] !== undefined) {
        const idx = arr.findIndex((r) => r[this.conflict!] === this.payload[this.conflict!]);
        if (idx >= 0) { arr[idx] = { ...arr[idx], ...this.payload }; return { data: [arr[idx]], error: null }; }
      }
      const row = { ...this.payload, id: this.payload.id ?? `${this.table}-${arr.length + 1}` };
      arr.push(row); return { data: [row], error: null };
    }
    if (this.op === "update") {
      const m = this.match(arr); for (const r of m) Object.assign(r, this.payload); return { data: m, error: null };
    }
    if (this.op === "delete") {
      const m = this.match(arr); for (const r of m) arr.splice(arr.indexOf(r), 1); return { data: m, error: null };
    }
    return { data: null, error: null };
  }
  async maybeSingle() { const r = this.exec(); return { data: r.data?.[0] ?? null, error: r.error }; }
  async single() { const r = this.exec(); return { data: r.data?.[0] ?? null, error: r.error }; }
  then(res: any, rej: any) {
    try { return Promise.resolve(this.exec()).then(res, rej); }
    catch (e) { return Promise.reject(e).then(res, rej); }
  }
}

function makeFake() {
  const tables: Record<string, Row[]> = {
    integration_connections: [],
    telehealth_oauth_tokens: [],
    telehealth_sessions: [],
  };
  return {
    tables,
    client: { from(t: string) { return new QB(tables, t); } },
  };
}

async function seedConnection(
  supabase: any,
  platform: "zoom" | "google_meet",
  refreshToken: string,
) {
  const { upsertConnection } = await import("../connections");
  await upsertConnection(supabase, {
    organizationId: ORG,
    ownerUserId: CLINICIAN_USER,
    platform,
    accountEmail: null,
    tokens: {
      accessToken: "expired-placeholder",
      refreshToken,
      // Forces loadAuthForProvider to refresh on the very next call.
      expiresAt: new Date(Date.now() - 60_000),
      scope: null,
      accountEmail: null,
    },
  });
}

before(() => {
  if (!LIVE) {
    // eslint-disable-next-line no-console
    console.log(
      "[telehealth live smoke] TELEHEALTH_E2E_LIVE!=1 — skipping (this is expected in CI without sandbox credentials).",
    );
  }
});

describe("LIVE: Zoom sandbox end-to-end", { skip: !LIVE }, () => {
  const have =
    !!process.env.ZOOM_CLIENT_ID &&
    !!process.env.ZOOM_CLIENT_SECRET &&
    !!process.env.ZOOM_SANDBOX_REFRESH_TOKEN;

  it(
    "refreshes a real access token, creates a real meeting, disconnects cleanly",
    { skip: !have, timeout: 30_000 },
    async () => {
      const fake = makeFake();
      await seedConnection(fake.client, "zoom", process.env.ZOOM_SANDBOX_REFRESH_TOKEN!);

      // 1. Real refresh-token grant against Zoom.
      const before = fake.tables.telehealth_oauth_tokens[0].access_token_enc;
      const { loadAuthForProvider } = await import("../connections");
      const auth = await loadAuthForProvider(fake.client as any, {
        organizationId: ORG,
        ownerUserId: CLINICIAN_USER,
        platform: "zoom",
      });
      assert.ok(auth, "live Zoom refresh returned null — sandbox token revoked?");
      assert.ok(auth!.accessToken && auth!.accessToken.length > 10);
      const after = fake.tables.telehealth_oauth_tokens[0].access_token_enc;
      assert.notEqual(after, before, "ciphertext must rotate after a real refresh");
      const expAt = fake.tables.telehealth_oauth_tokens[0].expires_at;
      assert.ok(expAt && new Date(expAt).getTime() > Date.now(), "expires_at must be in the future");

      // 2. Real meeting creation against Zoom.
      const { pickAdapter } = await import("../adapters");
      const adapter = pickAdapter("zoom");
      const startAt = new Date(Date.now() + 60 * 60_000).toISOString();
      const created = await adapter.createMeeting(auth!, {
        topic: "TherassistantEHR live smoke",
        startAt,
        durationMinutes: 30,
      });
      assert.match(
        created.joinUrl,
        /^https:\/\/[a-z0-9.-]*zoom\.us\/j\//i,
        `expected a real Zoom join URL, got: ${created.joinUrl}`,
      );
      assert.ok(created.externalMeetingId, "Zoom must return an external meeting id");

      // Persist the session like the live route does.
      await fake.client.from("telehealth_sessions").insert({
        organization_id: ORG,
        appointment_id: "live-appt-1",
        provider_id: null,
        scheduled_start_at: startAt,
        telehealth_vendor: "zoom",
        meeting_url: created.joinUrl,
        host_url: created.hostUrl,
        session_status: "scheduled",
        external_meeting_id: created.externalMeetingId,
      });
      assert.equal(fake.tables.telehealth_sessions.length, 1);

      // 3. Disconnect: both rows go away.
      const connId = fake.tables.integration_connections[0].id;
      const { deleteConnection } = await import("../connections");
      await deleteConnection(fake.client as any, connId);
      assert.equal(fake.tables.integration_connections.length, 0);
      assert.equal(fake.tables.telehealth_oauth_tokens.length, 0);
    },
  );
});

describe("LIVE: Google Meet sandbox end-to-end", { skip: !LIVE }, () => {
  const have =
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_SANDBOX_REFRESH_TOKEN;

  it(
    "refreshes a real access token, creates a real Meet event, disconnects cleanly",
    { skip: !have, timeout: 30_000 },
    async () => {
      const fake = makeFake();
      await seedConnection(fake.client, "google_meet", process.env.GOOGLE_SANDBOX_REFRESH_TOKEN!);

      const before = fake.tables.telehealth_oauth_tokens[0].access_token_enc;
      const { loadAuthForProvider } = await import("../connections");
      const auth = await loadAuthForProvider(fake.client as any, {
        organizationId: ORG,
        ownerUserId: CLINICIAN_USER,
        platform: "google_meet",
      });
      assert.ok(auth, "live Google refresh returned null — sandbox token revoked?");
      const after = fake.tables.telehealth_oauth_tokens[0].access_token_enc;
      assert.notEqual(after, before);

      const { pickAdapter } = await import("../adapters");
      const adapter = pickAdapter("google_meet");
      const startAt = new Date(Date.now() + 60 * 60_000).toISOString();
      const created = await adapter.createMeeting(auth!, {
        topic: "TherassistantEHR live smoke",
        startAt,
        durationMinutes: 30,
      });
      assert.match(
        created.joinUrl,
        /^https:\/\/meet\.google\.com\//,
        `expected a real Meet link, got: ${created.joinUrl}`,
      );
      assert.ok(created.externalMeetingId);

      const connId = fake.tables.integration_connections[0].id;
      const { deleteConnection } = await import("../connections");
      await deleteConnection(fake.client as any, connId);
      assert.equal(fake.tables.integration_connections.length, 0);
      assert.equal(fake.tables.telehealth_oauth_tokens.length, 0);
    },
  );
});
