// Canonical seed data has been removed. This module is intentionally left as
// a stub returning empty collections so the app shows real data only.
//
// Historic note: prior versions of this file contained a large in-memory
// "canonical" sample of the EHR (clients, encounters, claims, etc.) used by
// `lib/dashboard/homeData.ts`. That fallback was removed so the platform
// never presents fake data as if it were real.
//
// Real dashboard data should be queried from Supabase. See
// `lib/dashboard/homeData.ts` for the wiring point.

// Placeholder IDs kept so `lib/canonical-ehr/model.ts` continues to compile.
// They are intentionally non-routable, all-zeros UUIDs — model.ts uses them
// to stamp `created_by` / `signed_by` on in-memory canonical fixtures, which
// are no longer rendered anywhere user-facing.
export const ORG_ID = "00000000-0000-0000-0000-000000000000";
export const CURRENT_USER_ID = "00000000-0000-0000-0000-000000000000";
export const BILLER_USER_ID = "00000000-0000-0000-0000-000000000000";

export const canonicalSeed = {
  appointments: [] as unknown[],
  claims: [] as unknown[],
  encounters: [] as unknown[],
  workqueue_items: [] as unknown[],
  eligibility_checks: [] as unknown[],
  support_tickets: [] as unknown[],
};
