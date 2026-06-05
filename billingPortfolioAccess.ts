import { NextResponse } from "next/server";
import { requireAuthenticatedStaff, type StaffAuthContext } from "@/lib/rbac/auth";
import { PERMISSIONS, type PermissionCode, type StaffRoleCode } from "@/lib/rbac/constants";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";

export interface BillingPortfolioContext {
  operatingOrganizationId: string;
  organizationIds: string[];
  staffId: string | null;
  userId: string | null;
  roles: StaffRoleCode[];
  permissions: PermissionCode[];
  isDevPassthrough: boolean;
  isPortfolioAccess: boolean;
}

export interface BillingPortfolioAccessOptions {
  requestedOrganizationIds?: Array<string | null | undefined> | null;
  permission?: PermissionCode | null;
  scope?: string | null;
}

export function normalizeOrganizationIds(values: Array<string | null | undefined> | null | undefined) {
  return Array.from(
    new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function hasRequiredPermission(staffCtx: StaffAuthContext, permission: PermissionCode | null) {
  return !permission || staffCtx.permissions.includes(permission);
}

async function loadAuthorizedClientOrgIds(args: {
  operatingOrganizationId: string;
  targetOrganizationIds: string[];
  scope: string | null;
}) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase || args.targetOrganizationIds.length === 0) return new Set<string>();

  const query = supabase
    .from("billing_company_organization_access")
    .select("client_organization_id, scopes")
    .eq("billing_company_organization_id", args.operatingOrganizationId)
    .in("client_organization_id", args.targetOrganizationIds)
    .eq("access_status", "active")
    .is("archived_at", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return new Set(
    ((data ?? []) as Array<{ client_organization_id: string; scopes?: string[] | null }>)
      .filter((row) => {
        if (!args.scope) return true;
        const scopes = Array.isArray(row.scopes) ? row.scopes : [];
        return scopes.includes(args.scope) || scopes.includes("*");
      })
      .map((row) => row.client_organization_id),
  );
}

export async function requireBillingPortfolioAccess(
  options: BillingPortfolioAccessOptions = {},
): Promise<BillingPortfolioContext | NextResponse> {
  const staffCtx = await requireAuthenticatedStaff();
  const requested = normalizeOrganizationIds(options.requestedOrganizationIds);
  const permission =
    options.permission === undefined ? PERMISSIONS.VIEW_BILLING : options.permission;
  const scope = options.scope ?? (permission ? String(permission) : null);
  const env = process.env.NODE_ENV;

  if (!staffCtx) {
    if (env !== "development") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    return {
      operatingOrganizationId: requested[0] ?? DEFAULT_ORG_ID,
      organizationIds: requested.length ? requested : [DEFAULT_ORG_ID],
      staffId: null,
      userId: null,
      roles: [],
      permissions: [],
      isDevPassthrough: true,
      isPortfolioAccess: requested.length > 1,
    };
  }

  if (!hasRequiredPermission(staffCtx, permission)) {
    if (env !== "development") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
  }

  const targetOrgIds = requested.length ? requested : [staffCtx.organizationId];
  const sameOrgIds = targetOrgIds.filter((id) => id === staffCtx.organizationId);
  const externalOrgIds = targetOrgIds.filter((id) => id !== staffCtx.organizationId);

  if (externalOrgIds.length > 0 && env === "development") {
    return {
      operatingOrganizationId: staffCtx.organizationId,
      organizationIds: targetOrgIds,
      staffId: staffCtx.staffId,
      userId: staffCtx.userId || null,
      roles: staffCtx.roles,
      permissions: staffCtx.permissions,
      isDevPassthrough: false,
      isPortfolioAccess: true,
    };
  }

  const authorizedExternal = await loadAuthorizedClientOrgIds({
    operatingOrganizationId: staffCtx.organizationId,
    targetOrganizationIds: externalOrgIds,
    scope,
  });
  const unauthorized = externalOrgIds.filter((id) => !authorizedExternal.has(id));
  if (unauthorized.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Cannot access one or more client organizations from this billing-company account.",
        unauthorizedOrganizationIds: unauthorized,
      },
      { status: 403 },
    );
  }

  return {
    operatingOrganizationId: staffCtx.organizationId,
    organizationIds: [...sameOrgIds, ...externalOrgIds],
    staffId: staffCtx.staffId,
    userId: staffCtx.userId || null,
    roles: staffCtx.roles,
    permissions: staffCtx.permissions,
    isDevPassthrough: false,
    isPortfolioAccess: externalOrgIds.length > 0,
  };
}
