-- Persistent comments/notes thread for mailroom items.
create extension if not exists pgcrypto;

create table if not exists public.mailroom_item_notes (
  id uuid primary key default gen_random_uuid(),
  mailroom_item_id uuid not null references public.mailroom_items(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid,
  author_name text not null default 'Staff',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mailroom_item_notes_item
  on public.mailroom_item_notes (mailroom_item_id, created_at asc);

create index if not exists idx_mailroom_item_notes_org
  on public.mailroom_item_notes (organization_id, created_at desc);

alter table public.mailroom_item_notes enable row level security;

drop policy if exists mailroom_item_notes_org_policy on public.mailroom_item_notes;
create policy mailroom_item_notes_org_policy
  on public.mailroom_item_notes
  for all to authenticated
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''));

select pg_notify('pgrst', 'reload schema');
