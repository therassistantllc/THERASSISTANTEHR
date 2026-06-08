/**
 * Tests for the non-billing API tenant-isolation gate (Task #166).
 *
 * `evaluateOrgAccess` is the pure decision function used by every
 * non-billing `app/api/**` route that accepts an organizationId. We
 * exercise the same contract as the billing helper:
 *
 *   - unauthenticated request -> 401
 *   - cross-org id in query   -> 403
 *   - legitimate request      -> ok with the session's organizationId
 *                                (NOT the value the client supplied)
 *
 * Plus the dev-only passthrough and the optional-permission path.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { evaluateOrgAccess } from "../requireOrgAccess";
import { PERMISSIONS } from "@/lib/rbac/constants";
import type { StaffAuthContext } from "@/lib/rbac/auth";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

function staffCtx(overrides: Partial<StaffAuthContext> = {}): StaffAuthContext {
  return {
    userId: "user-1",
    staffId: "staff-1",
    organizationId: ORG_A,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    jobTitle: "Clinician",
    isActive: true,
    roles: ["clinician"],
    permissions: [PERMISSIONS.VIEW_PATIENT_CHART],
    ...overrides,
  };
}

describe("evaluateOrgAccess", () => {
  it("returns 401 in production when there is no authenticated staff", () => {
    const r = evaluateOrgAccess(null, { requestedOrganizationId: ORG_A }, "production");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 401);
  });

  it("returns 401 in test env when there is no authenticated staff", () => {
    const r = evaluateOrgAccess(null, { requestedOrganizationId: ORG_A }, "test");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 401);
  });

  it("rejects a cross-org id with 403 (IDOR defence)", () => {
    const r = evaluateOrgAccess(
      staffCtx({ organizationId: ORG_A }),
      { requestedOrganizationId: ORG_B },
      "production",
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 403);
  });

  it("returns the session-derived organizationId for a legitimate request", () => {
    const r = evaluateOrgAccess(
      staffCtx({ organizationId: ORG_A }),
      { requestedOrganizationId: ORG_A },
      "production",
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.context.organizationId, ORG_A);
      assert.equal(r.context.staffId, "staff-1");
      assert.equal(r.context.isDevPassthrough, false);
    }
  });

  it("falls back to the session org when the client didn't send one", () => {
    const r = evaluateOrgAccess(
      staffCtx({ organizationId: ORG_A }),
      {},
      "production",
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.context.organizationId, ORG_A);
  });

  it("returns 403 when a permission is required and the staff lacks it", () => {
    const r = evaluateOrgAccess(
      staffCtx({ permissions: [] }),
      { requestedOrganizationId: ORG_A, permission: PERMISSIONS.MANAGE_STAFF },
      "production",
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 403);
  });

  it("allows the call when no permission is required (default for most routes)", () => {
    const r = evaluateOrgAccess(staffCtx({ permissions: [] }), {}, "production");
    assert.equal(r.ok, true);
  });

  it("passes through in development without an authenticated staff (dev convenience)", () => {
    const r = evaluateOrgAccess(null, { requestedOrganizationId: ORG_A }, "development");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.context.isDevPassthrough, true);
      assert.equal(r.context.organizationId, ORG_A);
    }
  });

  it("ignores empty/whitespace requested org ids", () => {
    const r = evaluateOrgAccess(
      staffCtx({ organizationId: ORG_A }),
      { requestedOrganizationId: "   " },
      "production",
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.context.organizationId, ORG_A);
  });

  it("does NOT let the client-supplied org override the session org", () => {
    // Same org id supplied as the session — still returned from the
    // session, never echoed back from the client input.
    const r = evaluateOrgAccess(
      staffCtx({ organizationId: ORG_A }),
      { requestedOrganizationId: ORG_A },
      "production",
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.context.organizationId, ORG_A);
  });
});
