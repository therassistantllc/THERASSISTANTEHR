export const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export const TENANT_ID: string =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_TENANT_ID || process.env.NEXT_PUBLIC_ORGANIZATION_ID)) ||
  DEFAULT_TENANT_ID;

export const ORGANIZATION_ID = TENANT_ID;

export function getTenantIdFromSearchParams(searchParams: URLSearchParams): string {
  return searchParams.get("tenantId") || searchParams.get("organizationId") || TENANT_ID;
}

export function getTenantIdFromRequest(req: { nextUrl?: { searchParams: URLSearchParams }; url?: string }): string {
  if (req.nextUrl?.searchParams) {
    return getTenantIdFromSearchParams(req.nextUrl.searchParams);
  }

  if (req.url) {
    return getTenantIdFromSearchParams(new URL(req.url).searchParams);
  }

  return TENANT_ID;
}

export const getOrgIdFromSearchParams = getTenantIdFromSearchParams;
export const getOrgIdFromRequest = getTenantIdFromRequest;
