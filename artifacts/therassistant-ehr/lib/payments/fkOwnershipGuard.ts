/**
 * Cross-tenant FK ownership guard.
 *
 * Every API route that accepts a caller-supplied foreign key (claim id,
 * client id, batch id, etc.) and writes it into a tenant-scoped table
 * MUST verify the FK row belongs to the same organization. Otherwise a
 * caller in org A can mutate org A's row to point at org B's data.
 *
 * This helper centralizes the lookup pattern so routes don't reimplement
 * it inconsistently. Callers pass a minimal supabase-like client (so the
 * helper is trivial to unit-test without a live DB).
 */

export interface FkOwnershipSupabase {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        field: string,
        value: unknown,
      ) => {
        eq: (
          field: string,
          value: unknown,
        ) => {
          maybeSingle: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}

export class FkOwnershipError extends Error {
  readonly statusCode: number;
  readonly key: string;
  constructor(key: string, statusCode = 404) {
    super(`${key} not found in this organization.`);
    this.name = "FkOwnershipError";
    this.key = key;
    this.statusCode = statusCode;
  }
}

/**
 * Verifies that `id` exists in `table` for `organizationId`.
 * Throws FkOwnershipError(404) on miss, surfaces lookup errors otherwise.
 */
export async function assertFkBelongsToOrg(
  supabase: FkOwnershipSupabase,
  table: string,
  organizationId: string,
  id: string,
  key = table,
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to verify ${key} ownership: ${error.message}`);
  }
  if (!data?.id) {
    throw new FkOwnershipError(key);
  }
}
