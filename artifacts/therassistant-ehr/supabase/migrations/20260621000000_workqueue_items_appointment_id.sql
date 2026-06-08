-- Migration: 20260621000000_workqueue_items_appointment_id.sql
-- Purpose: Add appointment_id to workqueue_items so per-patient workqueue
--          queries (and routing helpers that need to tie a work item back
--          to the appointment it came from) can join to public.appointments.
--          Already selected by /api/patients/[clientId]/workqueue.

alter table public.workqueue_items
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

create index if not exists idx_workqueue_items_appointment
  on public.workqueue_items (organization_id, appointment_id)
  where appointment_id is not null;

select pg_notify('pgrst', 'reload schema');
