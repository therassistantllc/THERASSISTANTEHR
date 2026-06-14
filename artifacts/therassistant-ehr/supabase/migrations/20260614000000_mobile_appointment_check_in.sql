-- Migration: 20260614000000_mobile_appointment_check_in.sql
-- Purpose: Support mobile appointment check-in from the client portal/app.
--          Arrival state is separate from clinical check-in so "I'm here"
--          does not falsely mean the pre-session questions were completed.

alter table public.appointments
  add column if not exists client_arrival_status text not null default 'none',
  add column if not exists client_arrival_status_at timestamptz,
  add column if not exists check_in_answers jsonb not null default '{}'::jsonb,
  add column if not exists check_in_review_needed boolean not null default false,
  add column if not exists check_in_review_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_client_arrival_status_check'
  ) then
    alter table public.appointments
      add constraint appointments_client_arrival_status_check
      check (client_arrival_status in ('none', 'on_my_way', 'arrived'));
  end if;
end $$;

create index if not exists idx_appointments_mobile_check_in
  on public.appointments (organization_id, client_id, scheduled_start_at)
  where archived_at is null;

create index if not exists idx_appointments_checked_in
  on public.appointments (organization_id, check_in_at)
  where archived_at is null and check_in_at is not null;

select pg_notify('pgrst', 'reload schema');
