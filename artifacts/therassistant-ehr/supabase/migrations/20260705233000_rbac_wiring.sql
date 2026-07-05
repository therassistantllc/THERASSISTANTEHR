-- RBAC wiring for THERASSISTANT EHR.
-- Canonical model:
--   tenants = tenant/practice/billing-company boundary
--   tenant_users.user_id = auth.users.id
--   user_profiles.auth_user_id = auth.users.id
--   billing_company_practice_links links billing-company tenants to practice tenants

-- Correct cross-tenant billing-company links. Both columns are tenant ids.
alter table public.billing_company_practice_links
  drop constraint if exists billing_company_practice_links_billing_company_tenant_id_fkey,
  drop constraint if exists billing_company_practice_links_practice_tenant_id_fkey;

alter table public.billing_company_practice_links
  add constraint billing_company_practice_links_billing_company_tenant_id_fkey
    foreign key (billing_company_tenant_id) references public.tenants(id) on delete cascade,
  add constraint billing_company_practice_links_practice_tenant_id_fkey
    foreign key (practice_tenant_id) references public.tenants(id) on delete cascade;

create unique index if not exists permissions_permission_code_uidx
  on public.permissions(permission_code)
  where permission_code is not null;

create unique index if not exists tenant_roles_tenant_id_role_code_uidx
  on public.tenant_roles(tenant_id, role_code)
  where role_code is not null;

create unique index if not exists tenant_users_tenant_id_user_id_uidx
  on public.tenant_users(tenant_id, user_id);

create unique index if not exists tenant_user_roles_user_role_uidx
  on public.tenant_user_roles(tenant_user_id, tenant_role_id);

create unique index if not exists role_permissions_role_permission_uidx
  on public.role_permissions(tenant_role_id, permission_id);

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return nullif(trim(p_value), '')::uuid;
exception when others then
  return null;
end;
$$;

insert into public.permissions(permission_code, permission_name, module, action, description, is_sensitive, is_active)
select v.permission_code, v.permission_name, v.module, v.action, v.description, v.is_sensitive, true
from (values
  ('dashboard.read', 'View dashboards', 'dashboard', 'read'::public.permission_action_enum, 'View operational dashboards.', false),
  ('workqueue.read', 'View workqueues', 'workqueue', 'read'::public.permission_action_enum, 'View assigned workqueues.', false),
  ('schedule.read', 'View schedule', 'schedule', 'read'::public.permission_action_enum, 'View appointment schedules.', false),
  ('clients.read', 'View clients', 'clients', 'read'::public.permission_action_enum, 'View client demographic and account records.', true),
  ('clients.write', 'Manage clients', 'clients', 'update'::public.permission_action_enum, 'Create and update client records.', true),
  ('clinical.read', 'View clinical records', 'clinical', 'read'::public.permission_action_enum, 'View clinical documentation.', true),
  ('clinical.write', 'Manage clinical records', 'clinical', 'update'::public.permission_action_enum, 'Create, update, and sign clinical documentation.', true),
  ('billing.read', 'View billing', 'billing', 'read'::public.permission_action_enum, 'View billing and RCM records.', true),
  ('billing.write', 'Manage billing', 'billing', 'update'::public.permission_action_enum, 'Update billing and RCM records.', true),
  ('charge_capture.read', 'View charge capture', 'charge_capture', 'read'::public.permission_action_enum, 'View charge capture queues.', true),
  ('charge_capture.write', 'Manage charge capture', 'charge_capture', 'update'::public.permission_action_enum, 'Create and update charge capture items.', true),
  ('claims.read', 'View claims', 'claims', 'read'::public.permission_action_enum, 'View claims.', true),
  ('claims.write', 'Manage claims', 'claims', 'update'::public.permission_action_enum, 'Create and update claims.', true),
  ('claims.submit', 'Submit claims', 'claims', 'submit'::public.permission_action_enum, 'Submit claims and batches.', true),
  ('eligibility.read', 'View eligibility', 'eligibility', 'read'::public.permission_action_enum, 'View eligibility records.', true),
  ('eligibility.write', 'Manage eligibility', 'eligibility', 'update'::public.permission_action_enum, 'Create and update eligibility work.', true),
  ('payments.read', 'View payments', 'payments', 'read'::public.permission_action_enum, 'View payments, ERAs, EOBs, and ledgers.', true),
  ('payments.write', 'Manage payments', 'payments', 'update'::public.permission_action_enum, 'Create and update payment records.', true),
  ('payments.post', 'Post payments', 'payments', 'post'::public.permission_action_enum, 'Post insurance and patient payments.', true),
  ('denials.read', 'View denials', 'denials', 'read'::public.permission_action_enum, 'View denials, appeals, and follow-up queues.', true),
  ('denials.write', 'Manage denials', 'denials', 'update'::public.permission_action_enum, 'Work denials, appeals, and follow-up queues.', true),
  ('documents.read', 'View documents', 'documents', 'read'::public.permission_action_enum, 'View mailroom and document records.', true),
  ('documents.write', 'Manage documents', 'documents', 'update'::public.permission_action_enum, 'Upload, classify, and attach documents.', true),
  ('credentialing.read', 'View credentialing', 'credentialing', 'read'::public.permission_action_enum, 'View payer enrollment and credentialing work.', true),
  ('credentialing.write', 'Manage credentialing', 'credentialing', 'update'::public.permission_action_enum, 'Update payer enrollment and credentialing work.', true),
  ('reports.read', 'View reports', 'reports', 'read'::public.permission_action_enum, 'View operational and financial reports.', true),
  ('settings.read', 'View settings', 'settings', 'read'::public.permission_action_enum, 'View tenant settings.', false),
  ('settings.manage', 'Manage settings', 'settings', 'manage'::public.permission_action_enum, 'Manage tenant settings.', true),
  ('users.manage', 'Manage users and roles', 'settings', 'manage'::public.permission_action_enum, 'Invite users and manage roles.', true)
) as v(permission_code, permission_name, module, action, description, is_sensitive)
where not exists (
  select 1 from public.permissions p where p.permission_code = v.permission_code
);

with role_seed(role_code, role_name, description) as (
  values
    ('platform_admin'::public.system_role_enum, 'Platform Admin', 'Full platform administration.'),
    ('practice_admin'::public.system_role_enum, 'Practice Admin', 'Full practice administration.'),
    ('billing_company_admin'::public.system_role_enum, 'Billing Company Admin', 'Full billing-company RCM administration across linked practices.'),
    ('billing_manager'::public.system_role_enum, 'Billing Manager', 'Billing and RCM management.'),
    ('biller'::public.system_role_enum, 'Biller', 'Billing operations.'),
    ('clinician'::public.system_role_enum, 'Clinician', 'Clinical care and documentation.'),
    ('front_desk'::public.system_role_enum, 'Front Desk', 'Scheduling, intake, and front-office work.'),
    ('credentialing_specialist'::public.system_role_enum, 'Credentialing Specialist', 'Credentialing and payer enrollment work.'),
    ('read_only'::public.system_role_enum, 'Read Only', 'Read-only access.'),
    ('client'::public.system_role_enum, 'Client', 'Client portal access only.')
)
insert into public.tenant_roles(tenant_id, role_name, role_code, description, is_system_role, is_active)
select t.id, rs.role_name, rs.role_code, rs.description, true, true
from public.tenants t
cross join role_seed rs
where not exists (
  select 1
  from public.tenant_roles tr
  where tr.tenant_id = t.id
    and tr.role_code = rs.role_code
);

with role_permission_seed(role_code, permission_code) as (
  values
    ('platform_admin', '*'),
    ('practice_admin', '*'),
    ('billing_company_admin', 'dashboard.read'),
    ('billing_company_admin', 'workqueue.read'),
    ('billing_company_admin', 'clients.read'),
    ('billing_company_admin', 'billing.read'),
    ('billing_company_admin', 'billing.write'),
    ('billing_company_admin', 'charge_capture.read'),
    ('billing_company_admin', 'charge_capture.write'),
    ('billing_company_admin', 'claims.read'),
    ('billing_company_admin', 'claims.write'),
    ('billing_company_admin', 'claims.submit'),
    ('billing_company_admin', 'eligibility.read'),
    ('billing_company_admin', 'eligibility.write'),
    ('billing_company_admin', 'payments.read'),
    ('billing_company_admin', 'payments.write'),
    ('billing_company_admin', 'payments.post'),
    ('billing_company_admin', 'denials.read'),
    ('billing_company_admin', 'denials.write'),
    ('billing_company_admin', 'documents.read'),
    ('billing_company_admin', 'documents.write'),
    ('billing_company_admin', 'credentialing.read'),
    ('billing_company_admin', 'credentialing.write'),
    ('billing_company_admin', 'reports.read'),
    ('billing_manager', 'dashboard.read'),
    ('billing_manager', 'workqueue.read'),
    ('billing_manager', 'clients.read'),
    ('billing_manager', 'billing.read'),
    ('billing_manager', 'billing.write'),
    ('billing_manager', 'charge_capture.read'),
    ('billing_manager', 'charge_capture.write'),
    ('billing_manager', 'claims.read'),
    ('billing_manager', 'claims.write'),
    ('billing_manager', 'claims.submit'),
    ('billing_manager', 'eligibility.read'),
    ('billing_manager', 'eligibility.write'),
    ('billing_manager', 'payments.read'),
    ('billing_manager', 'payments.write'),
    ('billing_manager', 'payments.post'),
    ('billing_manager', 'denials.read'),
    ('billing_manager', 'denials.write'),
    ('billing_manager', 'documents.read'),
    ('billing_manager', 'documents.write'),
    ('billing_manager', 'reports.read'),
    ('biller', 'dashboard.read'),
    ('biller', 'workqueue.read'),
    ('biller', 'clients.read'),
    ('biller', 'billing.read'),
    ('biller', 'billing.write'),
    ('biller', 'charge_capture.read'),
    ('biller', 'charge_capture.write'),
    ('biller', 'claims.read'),
    ('biller', 'claims.write'),
    ('biller', 'eligibility.read'),
    ('biller', 'eligibility.write'),
    ('biller', 'payments.read'),
    ('biller', 'payments.write'),
    ('biller', 'payments.post'),
    ('biller', 'denials.read'),
    ('biller', 'denials.write'),
    ('biller', 'documents.read'),
    ('biller', 'reports.read'),
    ('clinician', 'dashboard.read'),
    ('clinician', 'workqueue.read'),
    ('clinician', 'schedule.read'),
    ('clinician', 'clients.read'),
    ('clinician', 'clients.write'),
    ('clinician', 'clinical.read'),
    ('clinician', 'clinical.write'),
    ('clinician', 'documents.read'),
    ('clinician', 'documents.write'),
    ('front_desk', 'dashboard.read'),
    ('front_desk', 'workqueue.read'),
    ('front_desk', 'schedule.read'),
    ('front_desk', 'clients.read'),
    ('front_desk', 'clients.write'),
    ('front_desk', 'eligibility.read'),
    ('front_desk', 'eligibility.write'),
    ('front_desk', 'documents.read'),
    ('front_desk', 'documents.write'),
    ('credentialing_specialist', 'dashboard.read'),
    ('credentialing_specialist', 'workqueue.read'),
    ('credentialing_specialist', 'clients.read'),
    ('credentialing_specialist', 'documents.read'),
    ('credentialing_specialist', 'documents.write'),
    ('credentialing_specialist', 'credentialing.read'),
    ('credentialing_specialist', 'credentialing.write'),
    ('credentialing_specialist', 'reports.read'),
    ('read_only', 'dashboard.read'),
    ('read_only', 'workqueue.read'),
    ('read_only', 'schedule.read'),
    ('read_only', 'clients.read'),
    ('read_only', 'billing.read'),
    ('read_only', 'claims.read'),
    ('read_only', 'eligibility.read'),
    ('read_only', 'payments.read'),
    ('read_only', 'denials.read'),
    ('read_only', 'documents.read'),
    ('read_only', 'reports.read')
)
insert into public.role_permissions(tenant_role_id, permission_id, allowed, scope)
select tr.id, p.id, true, 'tenant'::public.role_scope_enum
from public.tenant_roles tr
join role_permission_seed rps on rps.role_code = tr.role_code::text
join public.permissions p on rps.permission_code = '*' or p.permission_code = rps.permission_code
where tr.role_code in (
  'platform_admin', 'practice_admin', 'billing_company_admin', 'billing_manager', 'biller',
  'clinician', 'front_desk', 'credentialing_specialist', 'read_only'
)
and not exists (
  select 1
  from public.role_permissions rp
  where rp.tenant_role_id = tr.id
    and rp.permission_id = p.id
);

create or replace function public.get_current_user_id()
returns uuid
language sql
stable
set search_path to 'auth', 'public', 'pg_temp'
as $$
  select auth.uid();
$$;

create or replace function public.get_current_tenants_id()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_claims jsonb;
  v_tenant_id uuid;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := '{}'::jsonb;
  end;

  v_tenant_id := coalesce(
    public.try_uuid(v_claims ->> 'tenant_id'),
    public.try_uuid(v_claims ->> 'organization_id'),
    public.try_uuid(v_claims #>> '{app_metadata,tenant_id}'),
    public.try_uuid(v_claims #>> '{app_metadata,organization_id}')
  );

  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  select tu.tenant_id
  into v_tenant_id
  from public.tenant_users tu
  where tu.user_id = auth.uid()
    and tu.status = 'active'::public.user_status_enum
  order by coalesce(tu.accepted_at, tu.created_at) desc nulls last
  limit 1;

  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  select up.tenant_id
  into v_tenant_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and coalesce(up.is_active, true) = true
    and up.archived_at is null
  order by up.created_at desc nulls last
  limit 1;

  return v_tenant_id;
end;
$$;

create or replace function public.user_has_tenants_access(p_user_id uuid, p_tenants_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = p_tenants_id
        and tu.user_id = p_user_id
        and tu.status = 'active'::public.user_status_enum
    )
    or exists (
      select 1
      from public.user_profiles up
      where up.tenant_id = p_tenants_id
        and up.auth_user_id = p_user_id
        and coalesce(up.is_active, true) = true
        and up.archived_at is null
    ),
    false
  );
$$;

create or replace function public.user_has_role(p_user_id uuid, p_tenants_id uuid, p_role_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  with requested as (
    select lower(trim(coalesce(p_role_name, ''))) as role_name
  )
  select coalesce(
    exists (
      select 1
      from public.tenant_users tu
      join public.tenant_user_roles tur on tur.tenant_user_id = tu.id
      join public.tenant_roles tr on tr.id = tur.tenant_role_id
      cross join requested r
      where tu.tenant_id = p_tenants_id
        and tu.user_id = p_user_id
        and tu.status = 'active'::public.user_status_enum
        and (tur.expires_at is null or tur.expires_at > now())
        and coalesce(tr.is_active, true) = true
        and (
          lower(tr.role_code::text) = r.role_name
          or lower(coalesce(tr.role_name, '')) = r.role_name
          or (r.role_name = 'admin' and tr.role_code in ('platform_admin', 'practice_admin', 'billing_company_admin'))
          or (r.role_name = 'billing_company' and tr.role_code in ('billing_company_admin', 'billing_manager', 'biller'))
        )
    )
    or exists (
      select 1
      from public.user_profiles up
      cross join requested r
      where up.tenant_id = p_tenants_id
        and up.auth_user_id = p_user_id
        and coalesce(up.is_active, true) = true
        and up.archived_at is null
        and (
          lower(coalesce(up.role_code, '')) = r.role_name
          or (r.role_name = 'admin' and lower(coalesce(up.role_code, '')) in ('platform_admin', 'practice_admin', 'billing_company_admin'))
          or (r.role_name = 'billing_company' and lower(coalesce(up.role_code, '')) in ('billing_company_admin', 'billing_manager', 'biller'))
        )
    ),
    false
  );
$$;

create or replace function public.user_is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(
    exists (
      select 1
      from public.tenant_users tu
      join public.tenant_user_roles tur on tur.tenant_user_id = tu.id
      join public.tenant_roles tr on tr.id = tur.tenant_role_id
      where tu.user_id = p_user_id
        and tu.status = 'active'::public.user_status_enum
        and (tur.expires_at is null or tur.expires_at > now())
        and tr.role_code = 'platform_admin'::public.system_role_enum
        and coalesce(tr.is_active, true) = true
    )
    or exists (
      select 1
      from public.user_profiles up
      where up.auth_user_id = p_user_id
        and lower(coalesce(up.role_code, '')) = 'platform_admin'
        and coalesce(up.is_active, true) = true
        and up.archived_at is null
    ),
    false
  );
$$;

create or replace function public.is_cross_tenant_billing_permission(p_permission_code text)
returns boolean
language sql
immutable
as $$
  select p_permission_code = any(array[
    'dashboard.read', 'workqueue.read', 'clients.read', 'billing.read', 'billing.write',
    'charge_capture.read', 'charge_capture.write', 'claims.read', 'claims.write', 'claims.submit',
    'eligibility.read', 'eligibility.write', 'payments.read', 'payments.write', 'payments.post',
    'denials.read', 'denials.write', 'documents.read', 'documents.write',
    'credentialing.read', 'credentialing.write', 'reports.read'
  ]);
$$;

create or replace function public.user_has_direct_permission(p_user_id uuid, p_tenant_id uuid, p_permission_code text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_override boolean;
begin
  if p_user_id is null or p_tenant_id is null or nullif(trim(coalesce(p_permission_code, '')), '') is null then
    return false;
  end if;

  if public.user_is_platform_admin(p_user_id) then
    return true;
  end if;

  select upo.allowed
  into v_override
  from public.user_permission_overrides upo
  join public.tenant_users tu on tu.id = upo.tenant_user_id
  join public.permissions p on p.id = upo.permission_id
  where tu.tenant_id = p_tenant_id
    and tu.user_id = p_user_id
    and tu.status = 'active'::public.user_status_enum
    and p.permission_code = p_permission_code
    and coalesce(p.is_active, true) = true
    and (upo.expires_at is null or upo.expires_at > now())
  order by upo.created_at desc nulls last
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  return exists (
    select 1
    from public.tenant_roles tr
    join public.role_permissions rp on rp.tenant_role_id = tr.id
    join public.permissions p on p.id = rp.permission_id
    where tr.tenant_id = p_tenant_id
      and coalesce(tr.is_active, true) = true
      and rp.allowed = true
      and p.permission_code = p_permission_code
      and coalesce(p.is_active, true) = true
      and public.user_has_role(p_user_id, p_tenant_id, tr.role_code::text)
  );
end;
$$;

create or replace function public.user_has_permission(p_user_id uuid, p_tenant_id uuid, p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(
    public.user_has_direct_permission(p_user_id, p_tenant_id, p_permission_code)
    or (
      public.is_cross_tenant_billing_permission(p_permission_code)
      and exists (
        select 1
        from public.billing_company_practice_links bcpl
        where bcpl.practice_tenant_id = p_tenant_id
          and bcpl.billing_company_tenant_id is not null
          and coalesce(bcpl.status, 'active'::public.billing_company_link_status_enum) = 'active'::public.billing_company_link_status_enum
          and (bcpl.end_date is null or bcpl.end_date >= current_date)
          and public.user_has_direct_permission(p_user_id, bcpl.billing_company_tenant_id, p_permission_code)
      )
    ),
    false
  );
$$;

create or replace function public.user_can_access_practice(p_user_id uuid, p_practice_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(
    public.user_has_tenants_access(p_user_id, p_practice_id)
    or exists (
      select 1
      from public.billing_company_practice_links bcpl
      where bcpl.practice_tenant_id = p_practice_id
        and coalesce(bcpl.status, 'active'::public.billing_company_link_status_enum) = 'active'::public.billing_company_link_status_enum
        and (bcpl.end_date is null or bcpl.end_date >= current_date)
        and public.user_has_tenants_access(p_user_id, bcpl.billing_company_tenant_id)
    ),
    false
  );
$$;

create or replace function public.user_can_manage_billing(p_user_id uuid, p_practice_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(
    public.user_has_permission(p_user_id, p_practice_id, 'billing.write')
    or public.user_has_permission(p_user_id, p_practice_id, 'claims.write')
    or public.user_has_permission(p_user_id, p_practice_id, 'payments.post'),
    false
  );
$$;

create or replace function public.user_can_view_clinical_record(p_user_id uuid, p_clients_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(exists (
    select 1
    from public.clients c
    where c.id = p_clients_id
      and c.archived_at is null
      and public.user_has_direct_permission(p_user_id, c.tenant_id, 'clinical.read')
  ), false);
$$;

create or replace function public.user_can_view_financials(p_user_id uuid, p_clients_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select coalesce(exists (
    select 1
    from public.clients c
    where c.id = p_clients_id
      and c.archived_at is null
      and public.user_has_permission(p_user_id, c.tenant_id, 'billing.read')
  ), false);
$$;

create or replace function public.get_current_user_permissions(p_tenant_id uuid default null)
returns table(permission_code text)
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select p.permission_code
  from public.permissions p
  where coalesce(p.is_active, true) = true
    and p.permission_code is not null
    and public.user_has_permission(auth.uid(), coalesce(p_tenant_id, public.get_current_tenants_id()), p.permission_code)
  order by p.permission_code;
$$;

create or replace function public.get_current_tenant_context(p_tenant_id uuid default null)
returns table(
  tenant_id uuid,
  tenant_name text,
  role_codes text[],
  permission_codes text[]
)
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_tenant_id uuid := coalesce(p_tenant_id, public.get_current_tenants_id());
  v_roles text[];
  v_permissions text[];
begin
  select coalesce(array_agg(distinct role_code order by role_code), '{}')
  into v_roles
  from (
    select tr.role_code::text as role_code
    from public.tenant_users tu
    join public.tenant_user_roles tur on tur.tenant_user_id = tu.id
    join public.tenant_roles tr on tr.id = tur.tenant_role_id
    where tu.user_id = auth.uid()
      and tu.tenant_id = v_tenant_id
      and tu.status = 'active'::public.user_status_enum
      and (tur.expires_at is null or tur.expires_at > now())
      and coalesce(tr.is_active, true) = true
    union
    select lower(up.role_code) as role_code
    from public.user_profiles up
    where up.auth_user_id = auth.uid()
      and up.tenant_id = v_tenant_id
      and up.role_code is not null
      and coalesce(up.is_active, true) = true
      and up.archived_at is null
  ) roles;

  select coalesce(array_agg(g.permission_code order by g.permission_code), '{}')
  into v_permissions
  from public.get_current_user_permissions(v_tenant_id) g;

  return query
  select t.id, t.name, coalesce(v_roles, '{}'), coalesce(v_permissions, '{}')
  from public.tenants t
  where t.id = v_tenant_id
    and public.user_can_access_practice(auth.uid(), t.id);
end;
$$;

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.tenant_roles enable row level security;
alter table public.tenant_user_roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.billing_company_practice_links enable row level security;
alter table public.clients enable row level security;
alter table public.providers enable row level security;
alter table public.claims enable row level security;
alter table public.payments enable row level security;

drop policy if exists clients_select_authenticated on public.clients;
drop policy if exists clients_select_public on public.clients;

drop policy if exists tenants_select_rbac on public.tenants;
drop policy if exists tenants_manage_rbac on public.tenants;
create policy tenants_select_rbac on public.tenants
  for select to authenticated
  using (public.user_has_tenants_access(auth.uid(), id) or public.user_is_platform_admin(auth.uid()));
create policy tenants_manage_rbac on public.tenants
  for all to authenticated
  using (public.user_is_platform_admin(auth.uid()))
  with check (public.user_is_platform_admin(auth.uid()));

drop policy if exists tenant_users_select_rbac on public.tenant_users;
drop policy if exists tenant_users_manage_rbac on public.tenant_users;
create policy tenant_users_select_rbac on public.tenant_users
  for select to authenticated
  using (public.user_has_tenants_access(auth.uid(), tenant_id) or public.user_is_platform_admin(auth.uid()));
create policy tenant_users_manage_rbac on public.tenant_users
  for all to authenticated
  using (public.user_has_direct_permission(auth.uid(), tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  with check (public.user_has_direct_permission(auth.uid(), tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()));

drop policy if exists tenant_roles_select_rbac on public.tenant_roles;
drop policy if exists tenant_roles_manage_rbac on public.tenant_roles;
create policy tenant_roles_select_rbac on public.tenant_roles
  for select to authenticated
  using (public.user_has_tenants_access(auth.uid(), tenant_id) or public.user_is_platform_admin(auth.uid()));
create policy tenant_roles_manage_rbac on public.tenant_roles
  for all to authenticated
  using (public.user_has_direct_permission(auth.uid(), tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  with check (public.user_has_direct_permission(auth.uid(), tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()));

drop policy if exists tenant_user_roles_select_rbac on public.tenant_user_roles;
drop policy if exists tenant_user_roles_manage_rbac on public.tenant_user_roles;
create policy tenant_user_roles_select_rbac on public.tenant_user_roles
  for select to authenticated
  using (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_tenants_access(auth.uid(), tu.tenant_id) or public.user_is_platform_admin(auth.uid()))
  ));
create policy tenant_user_roles_manage_rbac on public.tenant_user_roles
  for all to authenticated
  using (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_direct_permission(auth.uid(), tu.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ))
  with check (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_direct_permission(auth.uid(), tu.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ));

drop policy if exists permissions_select_rbac on public.permissions;
drop policy if exists permissions_manage_rbac on public.permissions;
create policy permissions_select_rbac on public.permissions
  for select to authenticated
  using (coalesce(is_active, true) = true);
create policy permissions_manage_rbac on public.permissions
  for all to authenticated
  using (public.user_is_platform_admin(auth.uid()))
  with check (public.user_is_platform_admin(auth.uid()));

drop policy if exists role_permissions_select_rbac on public.role_permissions;
drop policy if exists role_permissions_manage_rbac on public.role_permissions;
create policy role_permissions_select_rbac on public.role_permissions
  for select to authenticated
  using (exists (
    select 1 from public.tenant_roles tr
    where tr.id = tenant_role_id
      and (public.user_has_tenants_access(auth.uid(), tr.tenant_id) or public.user_is_platform_admin(auth.uid()))
  ));
create policy role_permissions_manage_rbac on public.role_permissions
  for all to authenticated
  using (exists (
    select 1 from public.tenant_roles tr
    where tr.id = tenant_role_id
      and (public.user_has_direct_permission(auth.uid(), tr.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ))
  with check (exists (
    select 1 from public.tenant_roles tr
    where tr.id = tenant_role_id
      and (public.user_has_direct_permission(auth.uid(), tr.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ));

drop policy if exists user_permission_overrides_select_rbac on public.user_permission_overrides;
drop policy if exists user_permission_overrides_manage_rbac on public.user_permission_overrides;
create policy user_permission_overrides_select_rbac on public.user_permission_overrides
  for select to authenticated
  using (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_tenants_access(auth.uid(), tu.tenant_id) or public.user_is_platform_admin(auth.uid()))
  ));
create policy user_permission_overrides_manage_rbac on public.user_permission_overrides
  for all to authenticated
  using (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_direct_permission(auth.uid(), tu.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ))
  with check (exists (
    select 1 from public.tenant_users tu
    where tu.id = tenant_user_id
      and (public.user_has_direct_permission(auth.uid(), tu.tenant_id, 'users.manage') or public.user_is_platform_admin(auth.uid()))
  ));

drop policy if exists billing_company_practice_links_select_rbac on public.billing_company_practice_links;
drop policy if exists billing_company_practice_links_manage_rbac on public.billing_company_practice_links;
create policy billing_company_practice_links_select_rbac on public.billing_company_practice_links
  for select to authenticated
  using (
    public.user_has_tenants_access(auth.uid(), billing_company_tenant_id)
    or public.user_has_tenants_access(auth.uid(), practice_tenant_id)
    or public.user_is_platform_admin(auth.uid())
  );
create policy billing_company_practice_links_manage_rbac on public.billing_company_practice_links
  for all to authenticated
  using (
    public.user_has_direct_permission(auth.uid(), billing_company_tenant_id, 'settings.manage')
    or public.user_has_direct_permission(auth.uid(), practice_tenant_id, 'settings.manage')
    or public.user_is_platform_admin(auth.uid())
  )
  with check (
    public.user_has_direct_permission(auth.uid(), billing_company_tenant_id, 'settings.manage')
    or public.user_has_direct_permission(auth.uid(), practice_tenant_id, 'settings.manage')
    or public.user_is_platform_admin(auth.uid())
  );

drop policy if exists clients_select_rbac on public.clients;
drop policy if exists clients_insert_rbac on public.clients;
drop policy if exists clients_update_rbac on public.clients;
drop policy if exists clients_delete_rbac on public.clients;
create policy clients_select_rbac on public.clients
  for select to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'clients.read'));
create policy clients_insert_rbac on public.clients
  for insert to authenticated
  with check (public.user_has_direct_permission(auth.uid(), tenant_id, 'clients.write'));
create policy clients_update_rbac on public.clients
  for update to authenticated
  using (public.user_has_direct_permission(auth.uid(), tenant_id, 'clients.write'))
  with check (public.user_has_direct_permission(auth.uid(), tenant_id, 'clients.write'));
create policy clients_delete_rbac on public.clients
  for delete to authenticated
  using (public.user_has_direct_permission(auth.uid(), tenant_id, 'clients.write'));

drop policy if exists providers_select_rbac on public.providers;
drop policy if exists providers_manage_rbac on public.providers;
create policy providers_select_rbac on public.providers
  for select to authenticated
  using (public.user_can_access_practice(auth.uid(), tenant_id));
create policy providers_manage_rbac on public.providers
  for all to authenticated
  using (public.user_has_direct_permission(auth.uid(), tenant_id, 'settings.manage') or public.user_is_platform_admin(auth.uid()))
  with check (public.user_has_direct_permission(auth.uid(), tenant_id, 'settings.manage') or public.user_is_platform_admin(auth.uid()));

drop policy if exists claims_select_rbac on public.claims;
drop policy if exists claims_insert_rbac on public.claims;
drop policy if exists claims_update_rbac on public.claims;
drop policy if exists claims_delete_rbac on public.claims;
create policy claims_select_rbac on public.claims
  for select to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'claims.read'));
create policy claims_insert_rbac on public.claims
  for insert to authenticated
  with check (public.user_has_permission(auth.uid(), tenant_id, 'claims.write'));
create policy claims_update_rbac on public.claims
  for update to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'claims.write'))
  with check (public.user_has_permission(auth.uid(), tenant_id, 'claims.write'));
create policy claims_delete_rbac on public.claims
  for delete to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'claims.write'));

drop policy if exists payments_select_rbac on public.payments;
drop policy if exists payments_insert_rbac on public.payments;
drop policy if exists payments_update_rbac on public.payments;
drop policy if exists payments_delete_rbac on public.payments;
create policy payments_select_rbac on public.payments
  for select to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'payments.read'));
create policy payments_insert_rbac on public.payments
  for insert to authenticated
  with check (public.user_has_permission(auth.uid(), tenant_id, 'payments.post') or public.user_has_permission(auth.uid(), tenant_id, 'payments.write'));
create policy payments_update_rbac on public.payments
  for update to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'payments.post') or public.user_has_permission(auth.uid(), tenant_id, 'payments.write'))
  with check (public.user_has_permission(auth.uid(), tenant_id, 'payments.post') or public.user_has_permission(auth.uid(), tenant_id, 'payments.write'));
create policy payments_delete_rbac on public.payments
  for delete to authenticated
  using (public.user_has_permission(auth.uid(), tenant_id, 'payments.write'));

grant execute on function public.get_current_user_id() to authenticated;
grant execute on function public.get_current_tenants_id() to authenticated;
grant execute on function public.user_has_tenants_access(uuid, uuid) to authenticated;
grant execute on function public.user_has_role(uuid, uuid, text) to authenticated;
grant execute on function public.user_is_platform_admin(uuid) to authenticated;
grant execute on function public.user_has_direct_permission(uuid, uuid, text) to authenticated;
grant execute on function public.user_has_permission(uuid, uuid, text) to authenticated;
grant execute on function public.user_can_access_practice(uuid, uuid) to authenticated;
grant execute on function public.user_can_manage_billing(uuid, uuid) to authenticated;
grant execute on function public.user_can_view_clinical_record(uuid, uuid) to authenticated;
grant execute on function public.user_can_view_financials(uuid, uuid) to authenticated;
grant execute on function public.get_current_user_permissions(uuid) to authenticated;
grant execute on function public.get_current_tenant_context(uuid) to authenticated;
