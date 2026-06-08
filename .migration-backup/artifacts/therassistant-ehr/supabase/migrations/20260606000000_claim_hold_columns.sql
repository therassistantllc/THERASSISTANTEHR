-- Claim Hold queue support (Task #357)
--
-- Adds the columns the Claim Hold workqueue needs to track *why* a claim was
-- paused, *who* paused it, when follow-up is due, and who currently owns it.
-- Also widens the claim_status check so a claim can sit in the on_hold /
-- cancelled lanes outside of the normal validation pipeline.

alter table public.professional_claims
  add column if not exists hold_category text,
  add column if not exists hold_reason text,
  add column if not exists held_by_user_id uuid,
  add column if not exists held_by_display_name text,
  add column if not exists hold_started_at timestamptz,
  add column if not exists hold_follow_up_date date,
  add column if not exists hold_assigned_to_user_id uuid,
  add column if not exists hold_assigned_to_display_name text,
  add column if not exists hold_priority text;

alter table public.professional_claims
  drop constraint if exists professional_claims_claim_status_check;

alter table public.professional_claims
  add constraint professional_claims_claim_status_check
  check (
    claim_status = any (array[
      'draft','ready_for_validation','validation_failed','ready_for_batch',
      'batched','submitted','accepted_oa','rejected_oa','accepted_payer',
      'rejected_payer','paid','denied','voided','on_hold','cancelled'
    ])
  );

alter table public.professional_claims
  drop constraint if exists professional_claims_hold_category_check;
alter table public.professional_claims
  add constraint professional_claims_hold_category_check
  check (
    hold_category is null or hold_category = any (array[
      'manual','documentation','eligibility','auth','compliance','payer_rule'
    ])
  );

alter table public.professional_claims
  drop constraint if exists professional_claims_hold_priority_check;
alter table public.professional_claims
  add constraint professional_claims_hold_priority_check
  check (
    hold_priority is null or hold_priority = any (array['low','normal','high','urgent'])
  );

create index if not exists idx_professional_claims_hold_active
  on public.professional_claims (organization_id, hold_category, hold_started_at desc)
  where claim_status = 'on_hold' and archived_at is null;

notify pgrst, 'reload schema';
