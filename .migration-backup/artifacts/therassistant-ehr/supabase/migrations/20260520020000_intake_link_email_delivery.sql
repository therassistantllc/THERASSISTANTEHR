-- Migration: 20260520020000_intake_link_email_delivery.sql
-- Purpose: Track how intake links were delivered to patients (clipboard vs
--          email), the recipient address, and any provider error so staff
--          have a clear history in the chart.

alter table public.intake_links
  add column if not exists delivery_method text
    check (delivery_method in ('clipboard', 'email'))
    default 'clipboard',
  add column if not exists delivered_to_email text,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text,
  add column if not exists delivery_provider_id text,
  add column if not exists delivery_status text
    check (delivery_status in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  add column if not exists delivery_status_at timestamptz;

create index if not exists idx_intake_links_delivery_provider_id
  on public.intake_links (delivery_provider_id);

select pg_notify('pgrst', 'reload schema');
