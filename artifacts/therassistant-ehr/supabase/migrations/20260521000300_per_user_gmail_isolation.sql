-- Per-clinician Gmail isolation.
--
-- Adds owner_user_id (auth.users.id) to integration_connections and the
-- email-derived rows (inbound_email_messages, mailroom_items). Replaces the
-- old (organization_id, integration_type) unique with a pair of partial
-- unique indexes so that:
--   - non-user-scoped integrations (e.g. office-ally) remain one-per-org
--   - per-user integrations (gmail) get one connection per (org, type, user)
--
-- Also updates route_inbound_gmail_message to stamp owner_user_id on both
-- the inbound_email_messages and mailroom_items rows it creates, and turns on
-- RLS for inbound_email_messages so a future user-scoped Supabase client
-- cannot read another clinician's email even if app-level filters regress.

alter table public.integration_connections
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists scope_kind text not null default 'org'
    check (scope_kind in ('org', 'user'));

-- Drop the old single-row-per-(org,type) constraint and replace with partial
-- uniques. Use IF EXISTS so re-runs are safe.
alter table public.integration_connections
  drop constraint if exists integration_connections_organization_id_integration_type_key;

create unique index if not exists ic_org_type_shared_uniq
  on public.integration_connections (organization_id, integration_type)
  where owner_user_id is null;

create unique index if not exists ic_org_type_user_uniq
  on public.integration_connections (organization_id, integration_type, owner_user_id)
  where owner_user_id is not null;

create index if not exists ic_owner_user_idx
  on public.integration_connections (owner_user_id)
  where owner_user_id is not null;

-- Ensure scope_kind matches owner_user_id presence. Existing rows default to
-- 'org' and have null owner — consistent.
alter table public.integration_connections
  drop constraint if exists ic_scope_owner_consistent_chk;
alter table public.integration_connections
  add constraint ic_scope_owner_consistent_chk
    check (
      (scope_kind = 'user' and owner_user_id is not null) or
      (scope_kind = 'org'  and owner_user_id is null)
    );

-- ---------------------------------------------------------------------------
-- Stamp owner on the email-derived rows so reads can filter by current user.
-- ---------------------------------------------------------------------------

alter table public.inbound_email_messages
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists iem_owner_user_idx
  on public.inbound_email_messages (organization_id, owner_user_id, received_at desc);

alter table public.mailroom_items
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists mi_owner_user_idx
  on public.mailroom_items (organization_id, owner_user_id, created_at desc)
  where owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- Replace the routing RPC: take p_owner_user_id and stamp it everywhere.
-- We keep the existing behavior of upserting an inbound_email_messages row
-- and creating a mailroom_item; only the owner attribution is added.
-- ---------------------------------------------------------------------------

drop function if exists public.route_inbound_gmail_message(
  uuid, uuid, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
);

create or replace function public.route_inbound_gmail_message(
  p_organization_id uuid,
  p_integration_connection_id uuid,
  p_owner_user_id uuid,
  p_gmail_message_id text,
  p_gmail_thread_id text,
  p_gmail_history_id text,
  p_from_email text,
  p_from_name text,
  p_to_email text,
  p_subject text,
  p_snippet text,
  p_received_at timestamptz,
  p_raw_headers jsonb default '{}'::jsonb,
  p_raw_payload jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to public
as $$
declare
  v_email_id uuid;
  v_client_id uuid;
  v_profile_id uuid;
  v_provider_id uuid;
  v_mailroom_item_id uuid;
  v_workqueue_item_id uuid;
  v_title text;
  v_owner_check uuid;
begin
  -- Validate the owner truly belongs to this org. Defense-in-depth: a
  -- SECURITY DEFINER routine called with a forged user id should not be
  -- able to attribute someone else's email to that user.
  if p_owner_user_id is not null then
    select sp.auth_user_id into v_owner_check
    from public.staff_profiles sp
    where sp.auth_user_id = p_owner_user_id
      and sp.organization_id = p_organization_id
      and sp.is_active = true
      and sp.archived_at is null
    limit 1;
    if v_owner_check is null then
      raise exception 'owner_user_id % is not an active staff member of org %', p_owner_user_id, p_organization_id;
    end if;
  end if;

  -- Idempotent on gmail_message_id (per org).
  select iem.id into v_email_id
  from public.inbound_email_messages iem
  where iem.organization_id = p_organization_id
    and iem.gmail_message_id = p_gmail_message_id
    and iem.archived_at is null
  limit 1;

  if found then
    return v_email_id;
  end if;

  -- Sender-side matching (profile/client/provider). Same as the prior
  -- implementation; this only identifies *who sent* the message, not who
  -- owns the receiving mailbox.
  select p.id into v_profile_id
  from public.profiles p
  where lower(p.email) = lower(p_from_email)
    and (
      p.organization_id = p_organization_id
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = p.id
          and om.is_active = true
          and om.archived_at is null
          and om.ended_at is null
      )
    )
  limit 1;

  select c.id into v_client_id
  from public.clients c
  where c.organization_id = p_organization_id
    and c.archived_at is null
    and lower(c.email) = lower(p_from_email)
  limit 1;

  if v_client_id is null then
    select cc.client_id into v_client_id
    from public.client_contacts cc
    where cc.organization_id = p_organization_id
      and cc.archived_at is null
      and cc.contact_type = 'email'
      and lower(cc.value) = lower(p_from_email)
    order by cc.is_primary desc, cc.created_at desc
    limit 1;
  end if;

  insert into public.inbound_email_messages (
    organization_id,
    integration_connection_id,
    owner_user_id,
    provider,
    gmail_message_id,
    gmail_thread_id,
    gmail_history_id,
    from_email,
    from_name,
    to_email,
    subject,
    snippet,
    received_at,
    matched_profile_id,
    matched_client_id,
    matched_provider_id,
    processing_status,
    raw_headers,
    raw_payload
  )
  values (
    p_organization_id,
    p_integration_connection_id,
    p_owner_user_id,
    'gmail',
    p_gmail_message_id,
    p_gmail_thread_id,
    p_gmail_history_id,
    p_from_email,
    p_from_name,
    p_to_email,
    p_subject,
    p_snippet,
    p_received_at,
    v_profile_id,
    v_client_id,
    v_provider_id,
    'received',
    coalesce(p_raw_headers, '{}'::jsonb),
    p_raw_payload
  )
  returning id into v_email_id;

  -- Create a mailroom item, stamped with the owning clinician so it does not
  -- leak across the practice.
  v_title := coalesce(nullif(p_subject, ''), '(no subject)');

  insert into public.mailroom_items (
    organization_id,
    client_id,
    owner_user_id,
    file_name,
    mime_type,
    status,
    document_type,
    source,
    notes,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    v_client_id,
    p_owner_user_id,
    v_title,
    'message/rfc822',
    'needs_review',
    'inbound_email',
    'gmail',
    coalesce(nullif(p_snippet, ''), ''),
    now(),
    now()
  )
  returning id into v_mailroom_item_id;

  update public.inbound_email_messages
  set mailroom_item_id = v_mailroom_item_id
  where id = v_email_id;

  return v_email_id;
end;
$$;

alter function public.route_inbound_gmail_message(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
) owner to postgres;

revoke all on function public.route_inbound_gmail_message(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
) from public;
grant execute on function public.route_inbound_gmail_message(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Defense-in-depth RLS on inbound_email_messages.
-- The Edge Functions and Next.js API both use the service role key, which
-- bypasses RLS, so functionally this changes nothing today. If a future
-- refactor moves any read path to a user-scoped Supabase client, RLS will
-- enforce per-user isolation automatically.
-- ---------------------------------------------------------------------------

alter table public.inbound_email_messages enable row level security;

drop policy if exists iem_owner_select on public.inbound_email_messages;
create policy iem_owner_select
  on public.inbound_email_messages
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists iem_service_all on public.inbound_email_messages;
create policy iem_service_all
  on public.inbound_email_messages
  for all
  to service_role
  using (true)
  with check (true);

select pg_notify('pgrst', 'reload schema');
