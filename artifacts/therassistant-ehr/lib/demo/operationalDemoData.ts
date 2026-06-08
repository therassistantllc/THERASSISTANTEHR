// Demo data has been removed. This module is intentionally left as a stub
// returning empty collections so the app shows real data only.
//
// Historic note: prior versions of this file contained hard-coded sample
// appointments, claims, eligibility checks, etc., used by `lib/dashboard/
// homeData.ts` when the database was empty. That fallback was removed so the
// platform never presents fake data as if it were real.
//
// If you need a temporary fixture for local UI work, write it inline next to
// the test that needs it — do not reintroduce a global demo-data module.

export const demoOperationalData = {
  appointments: [] as unknown[],
  claims: [] as unknown[],
  workqueueItems: [] as unknown[],
  eligibilityChecks: [] as unknown[],
  supportTickets: [] as unknown[],
  clearinghouseActivity: [] as unknown[],
  patientBalanceQueue: [] as unknown[],
};
