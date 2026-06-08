-- The /api/mailroom (older) endpoint selects a set of legacy columns
-- declared in 20260511212500_digital_mailroom.sql. In some environments
-- (e.g. databases provisioned before that migration applied cleanly) these
-- columns are missing, causing PostgREST to return "column ... does not
-- exist" and the endpoint to 500.
--
-- This migration restores every legacy column idempotently so both the
-- legacy and compat API surfaces work, regardless of which migrations were
-- applied first. It is safe to run on a database that already has the
-- columns -- `add column if not exists` is a no-op there.

alter table public.mailroom_items
  add column if not exists mail_status text,
  add column if not exists priority text,
  add column if not exists document_type text,
  add column if not exists title text,
  add column if not exists sender_name text,
  add column if not exists payer_name text,
  add column if not exists received_date date,
  add column if not exists notes text,
  add column if not exists file_name text,
  add column if not exists file_mime_type text,
  add column if not exists file_size_bytes integer,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists filed_location text,
  add column if not exists filed_at timestamptz,
  add column if not exists filed_by_user_id uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_user_id uuid,
  add column if not exists handling_audit jsonb not null default '[]'::jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists uploaded_by_user_id uuid,
  add column if not exists assigned_to_user_id uuid;

-- Defaults for the constrained legacy columns so existing rows are valid.
update public.mailroom_items
  set mail_status = coalesce(mail_status, 'unsorted'),
      priority    = coalesce(priority, 'normal'),
      document_type = coalesce(document_type, 'other'),
      title       = coalesce(title, '(untitled)')
  where mail_status is null
     or priority is null
     or document_type is null
     or title is null;

-- Enforce NOT NULL after backfill, matching the original create table.
alter table public.mailroom_items
  alter column mail_status   set default 'unsorted',
  alter column priority      set default 'normal',
  alter column document_type set default 'other',
  alter column mail_status   set not null,
  alter column priority      set not null,
  alter column document_type set not null,
  alter column title         set not null,
  alter column handling_audit set default '[]'::jsonb,
  alter column handling_audit set not null;

select pg_notify('pgrst', 'reload schema');
