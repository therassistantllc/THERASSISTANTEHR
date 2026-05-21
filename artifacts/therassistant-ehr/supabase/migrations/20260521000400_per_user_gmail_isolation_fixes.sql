-- Fixes for the per-user Gmail isolation migration.
--
-- 1. The two partial unique indexes (ic_org_type_shared_uniq /
--    ic_org_type_user_uniq) cannot be used as ON CONFLICT arbiters by
--    supabase-js because it doesn't emit the index_predicate clause.
--    Replace with a single non-partial unique on
--    (organization_id, integration_type, owner_user_id) using
--    NULLS NOT DISTINCT so:
--      - org-shared rows (owner_user_id IS NULL) stay one-per-(org,type)
--      - per-user rows are uniquely keyed on the triple
--
-- 2. The previous route_inbound_gmail_message body did not populate the
--    legacy NOT NULL `title` column or `mail_status` on mailroom_items, so
--    every Gmail-derived insert would fail. Replace the function body to
--    populate both the legacy schema and the newer compat columns.

drop index if exists public.ic_org_type_shared_uniq;
drop index if exists public.ic_org_type_user_uniq;

alter table public.integration_connections
  drop constraint if exists ic_org_type_owner_uniq;
alter table public.integration_connections
  add constraint ic_org_type_owner_uniq
    unique nulls not distinct (organization_id, integration_type, owner_user_id);

-- Replace the RPC.
drop function if exists public.route_inbound_gmail_message(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text,
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
  v_title text;
  v_owner_check uuid;
begin
  -- Validate the owner truly belongs to this org (active staff).
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

  -- Sender-side matching.
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

  v_title := coalesce(nullif(p_subject, ''), '(no subject)');

  -- Insert into mailroom_items populating BOTH the legacy required columns
  -- (title, sender_name, mail_status, document_type) AND the newer compat
  -- columns (status, source, notes) used by /api/mailroom/items.
  insert into public.mailroom_items (
    organization_id,
    client_id,
    owner_user_id,
    title,
    sender_name,
    mail_status,
    document_type,
    file_name,
    file_mime_type,
    notes,
    status,
    source,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    v_client_id,
    p_owner_user_id,
    v_title,
    coalesce(nullif(p_from_name, ''), p_from_email),
    'unsorted',
    'other',
    v_title,
    'message/rfc822',
    coalesce(nullif(p_snippet, ''), ''),
    'needs_review',
    'inbound_email',
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

select pg_notify('pgrst', 'reload schema');
