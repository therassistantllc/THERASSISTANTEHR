-- RPC-backed scheduling appointments page to avoid API-layer N+1 joins.

create or replace function public.scheduling_appointments_page(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  provider_id uuid,
  provider_name text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  appointment_status text,
  appointment_type text,
  cpt_code text,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with matched as (
    select
      a.id,
      a.client_id,
      a.provider_id,
      a.scheduled_start_at,
      a.scheduled_end_at,
      a.appointment_status,
      a.appointment_type,
      a.cpt_code,
      count(*) over() as total_count
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.archived_at is null
      and a.scheduled_start_at >= p_from
      and a.scheduled_start_at < p_to
    order by a.scheduled_start_at asc
    limit greatest(coalesce(p_limit, 100), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    m.id,
    m.client_id,
    coalesce(
      nullif(concat_ws(' ', c.first_name, c.last_name), ''),
      'Unknown client'
    ) as client_name,
    m.provider_id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(concat_ws(' ', p.first_name, p.last_name), ''),
      'Unassigned'
    ) as provider_name,
    m.scheduled_start_at,
    m.scheduled_end_at,
    m.appointment_status,
    m.appointment_type,
    m.cpt_code,
    m.total_count
  from matched m
  left join public.clients c
    on c.id = m.client_id
  left join public.providers p
    on p.id = m.provider_id
  order by m.scheduled_start_at asc;
$$;

revoke all on function public.scheduling_appointments_page(uuid, timestamptz, timestamptz, integer, integer) from public;
revoke all on function public.scheduling_appointments_page(uuid, timestamptz, timestamptz, integer, integer) from authenticated, anon;
grant execute on function public.scheduling_appointments_page(uuid, timestamptz, timestamptz, integer, integer) to service_role;

select pg_notify('pgrst', 'reload schema');
