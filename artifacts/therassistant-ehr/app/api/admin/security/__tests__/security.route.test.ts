/**
 * Coverage for the admin Security page endpoints (Task #348).
 *
 * The Security page exposes four sensitive admin-only routes. These tests
 * pin the contracts a future refactor MUST NOT break:
 *
 *   POST /api/admin/security/password-reset
 *     - non-admin caller → 403 (requireRoleInRoute gate)
 *     - target staff in a different org → 403 (org-isolation guard)
 *     - happy path → 200 AND writes an audit_logs row with
 *       action=password_reset_sent for the targeted staff_profile
 *
 *   GET /api/admin/security/audit-log
 *     - non-admin caller → 403
 *     - the audit_logs read is scoped by organization_id (no cross-org bleed)
 *
 *   GET /api/admin/security/members
 *     - non-admin caller → 403
 *     - the staff_profiles read is scoped by organization_id
 *
 *   PATCH /api/admin/security/members/[staffId]/role
 *     - non-admin caller → 403
 *     - target staff in a different org → 403 (org-isolation guard)
 *     - "cannot remove the last admin" guard fires when no other active
 *       admins exist in the org → 403 AND NO audit row is written
 *     - happy path → 200 AND writes an audit_logs row with
 *       action=staff_role_changed referencing the targeted staff_profile
 *
 * Plus regression source-pins so the gates / org-scope filters / audit
 * actions can't be silently removed.
 */

import { strict as assert } from "node:assert";
import { before, beforeEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";
const ADMIN_STAFF = "11111111-1111-1111-1111-111111111111";
const TARGET_STAFF = "22222222-2222-2222-2222-222222222222";
const OTHER_STAFF = "33333333-3333-3333-3333-333333333333";
const ROLE_ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROLE_BILLER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;
type Filter = { field: string; value: unknown; op: string };
type Call = {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: Filter[];
};

type SelectFn = (filters: Filter[]) => { data: Row | Row[] | null; count?: number | null };
type InsertFn = (
  payload: unknown,
) => { data: unknown; error: { message: string } | null } | void;
type UpdateFn = (
  payload: unknown,
  filters: Filter[],
) => { data: unknown; error: { message: string } | null } | void;

type TableHandler = {
  select?: SelectFn;
  insert?: InsertFn;
  update?: UpdateFn;
};

function makeSupabase(handlers: Record<string, TableHandler>, sink?: Call[]) {
  const calls: Call[] = sink ?? [];

  function builder(table: string, op: Call["op"], payload?: unknown) {
    const filters: Filter[] = [];
    let settled: { data: unknown; error: { message: string } | null; count: number | null } | null =
      null;

    function settle() {
      if (settled) return settled;
      const handler = handlers[table];
      let data: unknown = null;
      let count: number | null = null;
      let error: { message: string } | null = null;
      if (handler) {
        if (op === "select" && handler.select) {
          const res = handler.select(filters);
          data = res.data;
          count = res.count ?? null;
        } else if (op === "insert" && handler.insert) {
          const res = handler.insert(payload);
          if (res) {
            data = res.data;
            error = res.error;
          }
        } else if (op === "update" && handler.update) {
          const res = handler.update(payload, filters);
          if (res) {
            data = res.data;
            error = res.error;
          }
        }
      }
      calls.push({ table, op, payload, filters: [...filters] });
      settled = { data, error, count };
      return settled;
    }

    const pushFilter = (opName: string) => (field: string, value: unknown) => {
      filters.push({ field, value, op: opName });
      return chain;
    };

    const chain: Record<string, unknown> = {};
    chain.select = (..._a: unknown[]) => chain;
    chain.eq = pushFilter("eq");
    chain.neq = pushFilter("neq");
    chain.gte = pushFilter("gte");
    chain.lte = pushFilter("lte");
    chain.in = pushFilter("in");
    chain.is = pushFilter("is");
    chain.not = (field: string, opName: string, value: unknown) => {
      filters.push({ field, value, op: `not.${opName}` });
      return chain;
    };
    chain.order = (..._a: unknown[]) => chain;
    chain.limit = (..._a: unknown[]) => chain;
    chain.range = (..._a: unknown[]) => chain;
    chain.single = async () => settle();
    chain.maybeSingle = async () => settle();
    chain.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      try {
        return Promise.resolve(onFulfilled(settle()));
      } catch (err) {
        return onRejected ? Promise.resolve(onRejected(err)) : Promise.reject(err);
      }
    };
    return chain;
  }

  return {
    supabase: {
      from(table: string) {
        return {
          select(..._a: unknown[]) {
            return builder(table, "select");
          },
          insert(payload: unknown) {
            return builder(table, "insert", payload);
          },
          update(payload: unknown) {
            return builder(table, "update", payload);
          },
        };
      },
    },
    calls,
  };
}

type Scenario = {
  // When set, requireRoleInRoute returns a JSON NextResponse with this status.
  authReject: { status: number; error: string } | null;
  organizationId: string;

  // staff_profiles lookup (used by password-reset, role PATCH)
  targetStaff: Row | null;
  // staff_roles lookup (used by role PATCH)
  targetRole: Row | null;
  // current staff_role_assignments for the target staff
  currentAssignments: Row[];
  // result of the "other admins" probe used by the last-admin guard
  otherAdmins: Row[];

  // audit_logs read (audit-log GET)
  auditRows: Row[];

  // members GET data
  membersStaff: Row[];
  membersAssignments: Row[];
  membersRoles: Row[];

  // serviceRole.auth.admin.generateLink result
  generateLinkError: { message: string } | null;
};

const scenario: Scenario = {
  authReject: null,
  organizationId: ORG_A,
  targetStaff: null,
  targetRole: null,
  currentAssignments: [],
  otherAdmins: [],
  auditRows: [],
  membersStaff: [],
  membersAssignments: [],
  membersRoles: [],
  generateLinkError: null,
};

let lastCalls: Call[] = [];
let generateLinkArgs: unknown[] = [];

function resetScenario() {
  scenario.authReject = null;
  scenario.organizationId = ORG_A;
  scenario.targetStaff = null;
  scenario.targetRole = null;
  scenario.currentAssignments = [];
  scenario.otherAdmins = [];
  scenario.auditRows = [];
  scenario.membersStaff = [];
  scenario.membersAssignments = [];
  scenario.membersRoles = [];
  scenario.generateLinkError = null;
  lastCalls = [];
  generateLinkArgs = [];
}

function buildSupabase() {
  // Share the calls sink across BOTH the admin client and the service-role
  // client so the route's audit_logs writes (admin client) and any service-
  // role reads land in the same `lastCalls` array.
  const built = makeSupabase({
    staff_profiles: {
      select: (filters) => {
        // role PATCH / password-reset path: .eq("id", staffId).single()
        const idFilter = filters.find((f) => f.field === "id" && f.op === "eq");
        if (idFilter) {
          if (!scenario.targetStaff) return { data: null };
          if ((scenario.targetStaff.id as string) !== idFilter.value) return { data: null };
          return { data: scenario.targetStaff };
        }
        // audit-log post-lookups: .in("auth_user_id", ...) or .in("id", ...)
        const inAuth = filters.find((f) => f.field === "auth_user_id" && f.op === "in");
        if (inAuth) return { data: [] };
        const inId = filters.find((f) => f.field === "id" && f.op === "in");
        if (inId) return { data: [] };
        // audit-log actorOptions OR members GET listing — both scoped by org.
        const orgFilter = filters.find((f) => f.field === "organization_id" && f.op === "eq");
        if (orgFilter && orgFilter.value === scenario.organizationId) {
          // Could be members listing OR audit-log actor options. The members
          // listing uses select(... is_active ...) and is the only path that
          // needs scenario.membersStaff rows. Both paths happily share this.
          return { data: scenario.membersStaff };
        }
        return { data: [] };
      },
    },
    staff_roles: {
      select: (filters) => {
        // role PATCH: .eq("id", newRoleId).single()
        const idFilter = filters.find((f) => f.field === "id" && f.op === "eq");
        if (idFilter) {
          if (!scenario.targetRole) return { data: null };
          if ((scenario.targetRole.id as string) !== idFilter.value) return { data: null };
          return { data: scenario.targetRole };
        }
        // members GET: org-scoped roles list
        return { data: scenario.membersRoles };
      },
    },
    staff_role_assignments: {
      select: (filters) => {
        const neqStaff = filters.find((f) => f.field === "staff_id" && f.op === "neq");
        if (neqStaff) {
          // last-admin probe
          return { data: scenario.otherAdmins };
        }
        const inStaff = filters.find((f) => f.field === "staff_id" && f.op === "in");
        if (inStaff) {
          // members GET join
          return { data: scenario.membersAssignments };
        }
        // current assignments for a single staff member (role PATCH)
        return { data: scenario.currentAssignments };
      },
      update: () => ({ data: null, error: null }),
      insert: () => ({ data: null, error: null }),
    },
    audit_logs: {
      select: (filters) => {
        // The .select("action") filter-options probe limits to non-null action.
        const actionOnly = filters.find((f) => f.op === "not.is" && f.field === "action");
        if (actionOnly) return { data: [] };
        return { data: scenario.auditRows, count: scenario.auditRows.length };
      },
      insert: () => ({ data: null, error: null }),
    },
  }, lastCalls);
  return built.supabase;
}

before(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";

  mock.module("@/lib/rbac/middleware", {
    namedExports: {
      requireRoleInRoute: async () => {
        const { NextResponse } = await import("next/server");
        if (scenario.authReject) {
          return NextResponse.json(
            { error: scenario.authReject.error },
            { status: scenario.authReject.status },
          );
        }
        return {
          staffId: ADMIN_STAFF,
          organizationId: scenario.organizationId,
          email: "admin@example.com",
          firstName: "Ada",
          lastName: "Min",
          roles: ["admin"],
          permissions: [],
        };
      },
      parseRequestBody: async (req: Request) => {
        try {
          return await req.json();
        } catch {
          const { NextResponse } = await import("next/server");
          return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }
      },
      isValidUuid: (v: string) =>
        typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    },
  });

  mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseAdminClient: () => buildSupabase(),
      createServerSupabaseServiceRoleClient: () => {
        const sb = buildSupabase() as unknown as Record<string, unknown>;
        (sb as { auth: unknown }).auth = {
          admin: {
            generateLink: async (input: unknown) => {
              generateLinkArgs.push(input);
              if (scenario.generateLinkError) {
                return { data: null, error: scenario.generateLinkError };
              }
              return { data: { properties: {} }, error: null };
            },
          },
        };
        return sb;
      },
    },
  });
});

beforeEach(() => {
  resetScenario();
});

function jsonReq(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// POST /api/admin/security/password-reset
// ---------------------------------------------------------------------------

describe("POST /api/admin/security/password-reset", () => {
  it("rejects non-admin callers with 403 (requireRoleInRoute gate)", async () => {
    scenario.authReject = { status: 403, error: "Insufficient role" };
    const { POST } = await import("../password-reset/route");
    const res = await POST(
      jsonReq("https://app.test/api/admin/security/password-reset", {
        staff_id: TARGET_STAFF,
      }) as never,
    );
    assert.equal(res.status, 403);
    // Gate must short-circuit BEFORE touching audit_logs or staff_profiles.
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
    assert.equal(lastCalls.filter((c) => c.table === "staff_profiles").length, 0);
  });

  it("refuses to reset a staff member that belongs to a different org (403)", async () => {
    scenario.organizationId = ORG_A;
    scenario.targetStaff = {
      id: TARGET_STAFF,
      organization_id: ORG_B,
      email: "x@y.test",
      auth_user_id: "auth-1",
      first_name: "Cross",
      last_name: "Org",
      archived_at: null,
    };
    const { POST } = await import("../password-reset/route");
    const res = await POST(
      jsonReq("https://app.test/api/admin/security/password-reset", {
        staff_id: TARGET_STAFF,
      }) as never,
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /organization mismatch/i);
    // Cross-org rejection must NOT send a recovery email and must NOT audit.
    assert.equal(generateLinkArgs.length, 0);
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
  });

  it("happy path writes a password_reset_sent audit_logs row for the target staff", async () => {
    scenario.targetStaff = {
      id: TARGET_STAFF,
      organization_id: ORG_A,
      email: "target@example.com",
      auth_user_id: "auth-2",
      first_name: "Tina",
      last_name: "Target",
      archived_at: null,
    };
    const { POST } = await import("../password-reset/route");
    const res = await POST(
      jsonReq("https://app.test/api/admin/security/password-reset", {
        staff_id: TARGET_STAFF,
      }) as never,
    );
    assert.equal(res.status, 200);
    // generateLink should have been invoked with a recovery type for the target email.
    assert.equal(generateLinkArgs.length, 1);
    const link = generateLinkArgs[0] as { type: string; email: string };
    assert.equal(link.type, "recovery");
    assert.equal(link.email, "target@example.com");

    const auditInsert = lastCalls.find((c) => c.table === "audit_logs" && c.op === "insert");
    assert.ok(auditInsert, "expected an audit_logs insert");
    const payload = auditInsert!.payload as Record<string, unknown>;
    assert.equal(payload.action, "password_reset_sent");
    assert.equal(payload.object_type, "staff_profile");
    assert.equal(payload.object_id, TARGET_STAFF);
    assert.equal(payload.organization_id, ORG_A);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/security/audit-log
// ---------------------------------------------------------------------------

describe("GET /api/admin/security/audit-log", () => {
  it("rejects non-admin callers with 403", async () => {
    scenario.authReject = { status: 403, error: "Insufficient role" };
    const { GET } = await import("../audit-log/route");
    const res = await GET(new Request("https://app.test/api/admin/security/audit-log") as never);
    assert.equal(res.status, 403);
    // Gate must short-circuit before touching audit_logs.
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
  });

  it("scopes the audit_logs read by the caller's organization_id", async () => {
    scenario.organizationId = ORG_A;
    scenario.auditRows = [
      {
        id: "log-1",
        created_at: "2026-01-02T00:00:00Z",
        user_id: null,
        user_role: "admin",
        action: "password_reset_sent",
        object_type: "staff_profile",
        object_id: TARGET_STAFF,
        event_summary: "Password reset email sent",
        event_metadata: {},
      },
    ];
    const { GET } = await import("../audit-log/route");
    const res = await GET(new Request("https://app.test/api/admin/security/audit-log") as never);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      entries: Array<{ id: string }>;
    };
    assert.equal(body.success, true);
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].id, "log-1");

    // Every audit_logs select must carry the org filter — no cross-org bleed.
    const auditReads = lastCalls.filter((c) => c.table === "audit_logs" && c.op === "select");
    assert.ok(auditReads.length >= 1);
    for (const call of auditReads) {
      assert.ok(
        call.filters.some(
          (f) => f.field === "organization_id" && f.op === "eq" && f.value === ORG_A,
        ),
        "audit_logs read must be scoped to the caller's organization_id",
      );
    }
  });

  it("surfaces billing-defaults / payer-status setting changes with field-level before/after", async () => {
    scenario.organizationId = ORG_A;
    scenario.auditRows = [
      {
        id: "log-bd",
        created_at: "2026-05-25T12:00:00Z",
        user_id: null,
        user_role: "admin",
        action: "billing_defaults_updated",
        object_type: "system_setting",
        object_id: null,
        event_summary: "Billing defaults: Claim Hold Period (days before submission) changed from 3 to 5",
        event_metadata: {
          setting_key: "billing.defaults",
          field: "claim_hold_days",
          field_label: "Claim Hold Period (days before submission)",
        },
        before_value: { claim_hold_days: 3 },
        after_value: { claim_hold_days: 5 },
      },
      {
        id: "log-ps",
        created_at: "2026-05-25T12:05:00Z",
        user_id: null,
        user_role: "admin",
        action: "payer_status_auto_check_updated",
        object_type: "system_setting",
        object_id: null,
        event_summary: "Payer status auto-check: Enable scheduled payer-status auto-checking changed from On to Off",
        event_metadata: {
          setting_key: "payer_status.auto_check",
          field: "enabled",
          field_label: "Enable scheduled payer-status auto-checking",
        },
        before_value: { enabled: true },
        after_value: { enabled: false },
      },
    ];
    const { GET } = await import("../audit-log/route");
    const res = await GET(new Request("https://app.test/api/admin/security/audit-log") as never);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      entries: Array<{
        id: string;
        action: string;
        settingKey: string | null;
        field: string | null;
        fieldLabel: string | null;
        beforeValue: unknown;
        afterValue: unknown;
        objectType: string | null;
      }>;
    };
    const bd = body.entries.find((e) => e.id === "log-bd")!;
    assert.ok(bd, "billing_defaults_updated entry should be returned");
    assert.equal(bd.action, "billing_defaults_updated");
    assert.equal(bd.objectType, "system_setting");
    assert.equal(bd.settingKey, "billing.defaults");
    assert.equal(bd.field, "claim_hold_days");
    assert.equal(bd.fieldLabel, "Claim Hold Period (days before submission)");
    assert.equal(bd.beforeValue, 3);
    assert.equal(bd.afterValue, 5);

    const ps = body.entries.find((e) => e.id === "log-ps")!;
    assert.ok(ps, "payer_status_auto_check_updated entry should be returned");
    assert.equal(ps.action, "payer_status_auto_check_updated");
    assert.equal(ps.settingKey, "payer_status.auto_check");
    assert.equal(ps.field, "enabled");
    assert.equal(ps.beforeValue, true);
    assert.equal(ps.afterValue, false);
  });

  it("filters by setting action so admins can scope to a single setting category", async () => {
    scenario.organizationId = ORG_A;
    scenario.auditRows = [
      {
        id: "log-bd",
        created_at: "2026-05-25T12:00:00Z",
        user_id: null,
        user_role: "admin",
        action: "billing_defaults_updated",
        object_type: "system_setting",
        object_id: null,
        event_summary: "x",
        event_metadata: { setting_key: "billing.defaults", field: "claim_hold_days" },
        before_value: { claim_hold_days: 3 },
        after_value: { claim_hold_days: 5 },
      },
    ];
    const { GET } = await import("../audit-log/route");
    const res = await GET(
      new Request(
        "https://app.test/api/admin/security/audit-log?action=billing_defaults_updated",
      ) as never,
    );
    assert.equal(res.status, 200);
    // The paginated audit_logs select must include an action=eq filter so the
    // category dropdown narrows the result set server-side.
    const auditReads = lastCalls.filter((c) => c.table === "audit_logs" && c.op === "select");
    const filteredRead = auditReads.find((c) =>
      c.filters.some(
        (f) => f.field === "action" && f.op === "eq" && f.value === "billing_defaults_updated",
      ),
    );
    assert.ok(
      filteredRead,
      "paginated audit_logs read must apply the action=billing_defaults_updated filter",
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/security/members
// ---------------------------------------------------------------------------

describe("GET /api/admin/security/members", () => {
  it("rejects non-admin callers with 403", async () => {
    scenario.authReject = { status: 403, error: "Insufficient role" };
    const { GET } = await import("../members/route");
    const res = await GET(new Request("https://app.test/api/admin/security/members") as never);
    assert.equal(res.status, 403);
    assert.equal(lastCalls.filter((c) => c.table === "staff_profiles").length, 0);
  });

  it("scopes the staff_profiles listing by the caller's organization_id", async () => {
    scenario.organizationId = ORG_A;
    scenario.membersStaff = [
      {
        id: TARGET_STAFF,
        first_name: "Tina",
        last_name: "Target",
        email: "tina@example.com",
        job_title: "Therapist",
        is_active: true,
        auth_user_id: "auth-2",
      },
    ];
    scenario.membersAssignments = [];
    scenario.membersRoles = [
      { id: ROLE_BILLER_ID, role_code: "biller", role_name: "Biller" },
    ];

    const { GET } = await import("../members/route");
    const res = await GET(new Request("https://app.test/api/admin/security/members") as never);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      members: Array<{ id: string }>;
    };
    assert.equal(body.success, true);
    assert.equal(body.members[0].id, TARGET_STAFF);

    const staffRead = lastCalls.find((c) => c.table === "staff_profiles" && c.op === "select");
    assert.ok(staffRead);
    assert.ok(
      staffRead!.filters.some(
        (f) => f.field === "organization_id" && f.op === "eq" && f.value === ORG_A,
      ),
      "members staff_profiles read must be scoped by organization_id",
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/security/members/[staffId]/role
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/security/members/[staffId]/role", () => {
  function roleReq(body: unknown): Request {
    return jsonReq(
      `https://app.test/api/admin/security/members/${TARGET_STAFF}/role`,
      body,
      "PATCH",
    );
  }
  const roleCtx = { params: Promise.resolve({ staffId: TARGET_STAFF }) };

  it("rejects non-admin callers with 403", async () => {
    scenario.authReject = { status: 403, error: "Insufficient role" };
    const { PATCH } = await import("../members/[staffId]/role/route");
    const res = await PATCH(roleReq({ role_id: ROLE_BILLER_ID }) as never, roleCtx);
    assert.equal(res.status, 403);
    // Must not write any audit_logs row when the gate denies.
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
  });

  it("refuses to change role for a staff member in a different org (403)", async () => {
    scenario.organizationId = ORG_A;
    scenario.targetStaff = {
      id: TARGET_STAFF,
      organization_id: ORG_B,
      first_name: "X",
      last_name: "Org",
      email: "x@y.test",
      archived_at: null,
    };
    const { PATCH } = await import("../members/[staffId]/role/route");
    const res = await PATCH(roleReq({ role_id: ROLE_BILLER_ID }) as never, roleCtx);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /organization mismatch/i);
    // No audit row, no assignment writes when the org guard fires.
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
    assert.equal(
      lastCalls.filter((c) => c.table === "staff_role_assignments" && c.op !== "select").length,
      0,
    );
  });

  it("refuses to demote the last remaining admin in the organization (403)", async () => {
    scenario.organizationId = ORG_A;
    scenario.targetStaff = {
      id: TARGET_STAFF,
      organization_id: ORG_A,
      first_name: "Only",
      last_name: "Admin",
      email: "only@example.com",
      archived_at: null,
    };
    scenario.targetRole = {
      id: ROLE_BILLER_ID,
      role_code: "biller",
      role_name: "Biller",
      organization_id: ORG_A,
      archived_at: null,
    };
    scenario.currentAssignments = [
      {
        id: "assignment-1",
        staff_role_id: ROLE_ADMIN_ID,
        staff_roles: { role_code: "admin", role_name: "Admin" },
      },
    ];
    scenario.otherAdmins = []; // <- nobody else holds admin

    const { PATCH } = await import("../members/[staffId]/role/route");
    const res = await PATCH(roleReq({ role_id: ROLE_BILLER_ID }) as never, roleCtx);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /last admin/i);

    // The guard must fire BEFORE any assignment mutation or audit row.
    assert.equal(lastCalls.filter((c) => c.table === "audit_logs").length, 0);
    assert.equal(
      lastCalls.filter(
        (c) => c.table === "staff_role_assignments" && (c.op === "insert" || c.op === "update"),
      ).length,
      0,
    );
  });

  it("happy path writes a staff_role_changed audit_logs row for the target", async () => {
    scenario.organizationId = ORG_A;
    scenario.targetStaff = {
      id: TARGET_STAFF,
      organization_id: ORG_A,
      first_name: "Tina",
      last_name: "Target",
      email: "tina@example.com",
      archived_at: null,
    };
    scenario.targetRole = {
      id: ROLE_BILLER_ID,
      role_code: "biller",
      role_name: "Biller",
      organization_id: ORG_A,
      archived_at: null,
    };
    scenario.currentAssignments = [
      {
        id: "assignment-old",
        staff_role_id: ROLE_ADMIN_ID,
        staff_roles: { role_code: "admin", role_name: "Admin" },
      },
    ];
    // Another active admin exists, so the last-admin guard does not fire.
    scenario.otherAdmins = [
      { staff_id: OTHER_STAFF, staff_roles: { role_code: "admin" } },
    ];

    const { PATCH } = await import("../members/[staffId]/role/route");
    const res = await PATCH(roleReq({ role_id: ROLE_BILLER_ID }) as never, roleCtx);
    assert.equal(res.status, 200);

    const auditInsert = lastCalls.find((c) => c.table === "audit_logs" && c.op === "insert");
    assert.ok(auditInsert, "expected an audit_logs insert");
    const payload = auditInsert!.payload as Record<string, unknown>;
    assert.equal(payload.action, "staff_role_changed");
    assert.equal(payload.object_type, "staff_profile");
    assert.equal(payload.object_id, TARGET_STAFF);
    assert.equal(payload.organization_id, ORG_A);
    const after = payload.after_value as { roles: string[] };
    assert.deepEqual(after.roles, ["biller"]);
  });
});

// ---------------------------------------------------------------------------
// Regression source-pins — refactors must not silently drop these guards.
// ---------------------------------------------------------------------------

describe("regression: admin Security route wiring", () => {
  const passwordResetSrc = readFileSync(
    "app/api/admin/security/password-reset/route.ts",
    "utf8",
  );
  const auditLogSrc = readFileSync("app/api/admin/security/audit-log/route.ts", "utf8");
  const membersSrc = readFileSync("app/api/admin/security/members/route.ts", "utf8");
  const roleSrc = readFileSync(
    "app/api/admin/security/members/[staffId]/role/route.ts",
    "utf8",
  );

  it("all four routes gate on requireRoleInRoute(STAFF_ROLES.ADMIN)", () => {
    for (const src of [passwordResetSrc, auditLogSrc, membersSrc, roleSrc]) {
      assert.match(src, /requireRoleInRoute\(\s*STAFF_ROLES\.ADMIN\s*\)/);
    }
  });

  it("password-reset writes a password_reset_sent audit_logs row", () => {
    assert.match(passwordResetSrc, /\.from\("audit_logs"\)/);
    assert.match(passwordResetSrc, /password_reset_sent/);
  });

  it("audit-log scopes the audit_logs read by organization_id", () => {
    assert.match(
      auditLogSrc,
      /\.from\("audit_logs"\)[\s\S]*?\.eq\("organization_id",\s*organizationId\)/,
    );
  });

  it("members listing scopes the staff_profiles read by organization_id", () => {
    assert.match(
      membersSrc,
      /\.from\("staff_profiles"\)[\s\S]*?\.eq\("organization_id",\s*organizationId\)/,
    );
  });

  it("role PATCH carries an explicit last-admin guard and writes a staff_role_changed audit row", () => {
    assert.match(roleSrc, /last admin/i);
    assert.match(roleSrc, /staff_role_changed/);
  });

  it("role PATCH enforces target-staff org isolation", () => {
    assert.match(roleSrc, /organization mismatch/i);
  });
});
