-- Task #702: track reminders sent for open eligibility routing handoffs.
--
-- When a biller routes an eligibility issue to a clinician or admin, an
-- inbox row + email goes out via Task #625. If the assignee doesn't act
-- before the configured threshold (default 24h), a scheduled scan
-- re-notifies them. We need a per-workqueue-item log so:
--   1. the scan can decide "did I already remind for this item, and how
--      long ago?" without re-emailing every run, and
--   2. the audit trail clearly distinguishes initial routing from
--      reminders (each reminder is its own row + its own audit_logs entry).
--
-- A separate table is simpler than overloading staff_notification_preferences
-- (which is keyed per-staff, not per-item) or context_payload on
-- workqueue_items (which is a free-form blob that other code rewrites).

create table if not exists public.eligibility_routing_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workqueue_item_id uuid not null references public.workqueue_items(id) on delete cascade,
  assigned_to_staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  reminder_number int not null,
  sent_at timestamptz not null default now(),
  email_sent boolean not null default false,
  channel_attempts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_eligibility_routing_reminders_item
  on public.eligibility_routing_reminders (workqueue_item_id, sent_at desc);

create index if not exists idx_eligibility_routing_reminders_org_sent
  on public.eligibility_routing_reminders (organization_id, sent_at desc);

notify pgrst, 'reload schema';
