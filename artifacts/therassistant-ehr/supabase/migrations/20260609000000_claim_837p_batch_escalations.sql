-- Transmission Failure escalations as routable records (Task #443)
--
-- Replaces the free-text "prepend to submission_error" escalation model with
-- a real row-per-escalation table so escalations have an assignee, priority,
-- and lifecycle. Adds batch-level assignment columns so the universal
-- "Assigned biller" filter on the Transmission Failures workqueue can push
-- down at the DB layer.

create table if not exists public.claim_837p_batch_escalations (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  batch_id                 uuid not null references public.claim_837p_batches(id) on delete cascade,
  status                   text not null default 'open',
  priority                 text not null default 'normal',
  note                     text,
  assigned_to_user_id      uuid,
  assigned_to_display_name text,
  opened_by_user_id        uuid,
  opened_at                timestamptz not null default now(),
  resolved_by_user_id      uuid,
  resolved_at              timestamptz,
  resolution_note          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint claim_837p_batch_escalations_status_chk
    check (status in ('open', 'resolved', 'cancelled')),
  constraint claim_837p_batch_escalations_priority_chk
    check (priority in ('low', 'normal', 'high', 'urgent'))
);

create index if not exists idx_claim_837p_batch_escalations_open
  on public.claim_837p_batch_escalations (organization_id, batch_id, opened_at desc)
  where status = 'open';

create index if not exists idx_claim_837p_batch_escalations_assignee
  on public.claim_837p_batch_escalations (organization_id, assigned_to_user_id, status, opened_at desc)
  where assigned_to_user_id is not null;

create or replace function public.claim_837p_batch_escalations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists claim_837p_batch_escalations_set_updated_at
  on public.claim_837p_batch_escalations;
create trigger claim_837p_batch_escalations_set_updated_at
  before update on public.claim_837p_batch_escalations
  for each row execute function public.claim_837p_batch_escalations_touch_updated_at();

alter table public.claim_837p_batch_escalations enable row level security;

drop policy if exists "claim_837p_batch_escalations_tenant"
  on public.claim_837p_batch_escalations;
create policy "claim_837p_batch_escalations_tenant"
  on public.claim_837p_batch_escalations
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

-- Batch-level assignee so the universal filter rail can push down at SQL.
-- These mirror the currently-open escalation's assignee; the API keeps them
-- in sync.
alter table public.claim_837p_batches
  add column if not exists assigned_to_user_id      uuid,
  add column if not exists assigned_to_display_name text;

create index if not exists idx_claim_837p_batches_assigned_biller
  on public.claim_837p_batches (organization_id, assigned_to_user_id)
  where assigned_to_user_id is not null and archived_at is null;

notify pgrst, 'reload schema';
