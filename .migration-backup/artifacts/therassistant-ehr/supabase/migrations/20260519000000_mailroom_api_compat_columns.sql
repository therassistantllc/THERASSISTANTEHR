-- Migration: 20260519000000_mailroom_api_compat_columns.sql
-- Purpose: Add API-expected columns to mailroom_items that are missing from the
--          original table definition (status, mime_type, source, admin_comments).
--          These are required for the mailroom/items API route to function correctly.

alter table public.mailroom_items
  add column if not exists status        text not null default 'needs_review',
  add column if not exists mime_type     text,
  add column if not exists source        text not null default 'manual_upload',
  add column if not exists admin_comments text;

create index if not exists idx_mailroom_items_status_col
  on public.mailroom_items (organization_id, status, created_at desc)
  where archived_at is null;

select pg_notify('pgrst', 'reload schema');
