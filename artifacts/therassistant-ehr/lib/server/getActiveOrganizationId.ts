import "server-only";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Resolve the active organization id for a server-rendered page.
 *
 * Order of precedence:
 *   1. The authenticated staff session (auth.organizationId)
 *   2. The server-configured ORGANIZATION_ID env fallback
 *
 * Query-string `organizationId` is intentionally NOT consulted here — pages
 * should never depend on the URL to know which org the logged-in user belongs
 * to.
 */
export async function getActiveOrganizationId(): Promise<string> {
  try {
    const ctx = await requireAuthenticatedStaff();
    if (ctx?.organizationId) return ctx.organizationId;
  } catch {
    // fall through to env fallback
  }
  return ORGANIZATION_ID;
}
