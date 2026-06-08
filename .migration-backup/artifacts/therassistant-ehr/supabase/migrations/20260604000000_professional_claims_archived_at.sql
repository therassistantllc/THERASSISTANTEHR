-- Task #319: add the missing soft-delete column to professional_claims.
--
-- The dedupe sweep in 20260601000000_find_or_create_dedupe_indexes.sql tried
-- to install idx_professional_claims_unique_active_encounter with the
-- standard `where archived_at is null and encounter_id is not null`
-- predicate that the rest of the EHR uses. It failed against live Supabase
-- because public.professional_claims never got an `archived_at` column even
-- though sibling claim tables and the application code already treat it as
-- the soft-delete signal (see lib/claims/claimReadinessService.ts,
-- lib/claims/chargeCaptureClaimBridgeService.ts,
-- app/api/claims/create-from-encounter/route.ts,
-- app/api/claims/837p/batch/[id]/revalidate/route.ts).
--
-- Without the predicate the unique index treats archived rows as still
-- occupying the dedupe slot, so re-creating a claim for an encounter whose
-- previous claim was archived would raise 23505 instead of inserting the
-- replacement. Add the column, then rebuild the index in its proper partial
-- form so soft-deletes actually free up the slot.

alter table public.professional_claims
  add column if not exists archived_at timestamptz null;

drop index if exists public.idx_professional_claims_unique_active_encounter;

create unique index if not exists idx_professional_claims_unique_active_encounter
  on public.professional_claims (organization_id, encounter_id)
  where archived_at is null and encounter_id is not null;

select pg_notify('pgrst', 'reload schema');
