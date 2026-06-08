-- Secondary Billing Needed workqueue: authoritative claim-level state.
--
-- The /billing/secondary-billing workqueue needs to persist actions
-- (generate / submit / hold / attach EOB / error) on the claim itself
-- instead of deriving everything from audit_logs, so that downstream
-- consumers (other queues, reports, the claim timeline) see the same
-- truth the UI shows.
alter table public.professional_claims
  add column if not exists secondary_billing_state                text,
  add column if not exists secondary_billing_eob_attached_at      timestamptz,
  add column if not exists secondary_billing_eob_reference        text,
  add column if not exists secondary_billing_generated_at         timestamptz,
  add column if not exists secondary_billing_submitted_at         timestamptz,
  add column if not exists secondary_billing_last_error           text,
  add column if not exists secondary_billing_assigned_to_user_id  uuid,
  add column if not exists secondary_billing_follow_up_due        date;

do $$
begin
  if not exists (
    select 1
      from information_schema.check_constraints
     where constraint_schema = 'public'
       and constraint_name   = 'professional_claims_secondary_billing_state_check'
  ) then
    alter table public.professional_claims
      add constraint professional_claims_secondary_billing_state_check
      check (
        secondary_billing_state is null or
        secondary_billing_state in (
          'ready', 'missing_eob', 'cob_issue', 'hold',
          'generated', 'submitted', 'error'
        )
      );
  end if;
end$$;

create index if not exists idx_professional_claims_sec_billing_state
  on public.professional_claims (organization_id, secondary_billing_state)
  where secondary_billing_state is not null and archived_at is null;

create index if not exists idx_professional_claims_sec_billing_assigned
  on public.professional_claims (
    organization_id, secondary_billing_assigned_to_user_id
  )
  where secondary_billing_assigned_to_user_id is not null
    and archived_at is null;
