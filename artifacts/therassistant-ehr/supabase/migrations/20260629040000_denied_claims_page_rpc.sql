-- RPC-backed denied claims page with server-side joins, filters, and pagination.

create or replace function public.billing_denied_claims_page(
  p_organization_id uuid,
  p_practice text default null,
  p_appointment_ids uuid[] default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  claim_number text,
  claim_status text,
  client_id uuid,
  client_name text,
  payer_name text,
  provider_name text,
  provider_id uuid,
  practice_id text,
  date_of_service date,
  total_charge numeric(12,2),
  patient_responsibility numeric(12,2),
  payer_paid numeric(12,2),
  denial_reason_code text,
  denial_reason_description text,
  appeal_deadline_date date,
  correction_status text,
  correction_type text,
  billing_notes text,
  submitted_at timestamptz,
  created_at timestamptz,
  cpt_code text,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with matched as (
    select
      pc.id,
      pc.claim_number,
      pc.claim_status,
      pc.client_id,
      pc.total_charge,
      pc.patient_responsibility_amount,
      pc.payer_responsibility_amount,
      pc.denial_reason_code,
      pc.denial_reason_description,
      pc.appeal_deadline_date,
      pc.correction_status,
      pc.correction_type,
      pc.billing_notes,
      pc.submitted_at,
      pc.created_at,
      pc.first_billed_date,
      a.id as appointment_id,
      a.scheduled_start_at,
      a.provider_id,
      a.provider_location_id,
      c.first_name as client_first_name,
      c.last_name as client_last_name,
      pp.payer_name,
      p.display_name as provider_display_name,
      p.first_name as provider_first_name,
      p.last_name as provider_last_name,
      count(*) over() as total_count
    from public.professional_claims pc
    left join public.clients c
      on c.id = pc.client_id
    left join public.payer_profiles pp
      on pp.id = pc.payer_profile_id
    left join public.appointments a
      on a.id = pc.appointment_id
    left join public.providers p
      on p.id = a.provider_id
    where pc.organization_id = p_organization_id
      and pc.claim_status = 'denied'
      and pc.archived_at is null
      and (p_practice is null or p_practice = '' or a.provider_location_id::text = p_practice)
      and (p_appointment_ids is null or array_length(p_appointment_ids, 1) is null or pc.appointment_id = any(p_appointment_ids))
    order by pc.updated_at desc
    limit greatest(coalesce(p_limit, 100), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    m.id,
    m.claim_number,
    m.claim_status,
    m.client_id,
    coalesce(nullif(concat_ws(' ', m.client_first_name, m.client_last_name), ''), '—') as client_name,
    coalesce(m.payer_name, '—') as payer_name,
    coalesce(
      nullif(btrim(m.provider_display_name), ''),
      nullif(concat_ws(' ', m.provider_first_name, m.provider_last_name), ''),
      null
    ) as provider_name,
    m.provider_id,
    m.provider_location_id::text as practice_id,
    coalesce(m.scheduled_start_at::date, m.first_billed_date) as date_of_service,
    coalesce(m.total_charge, 0)::numeric(12,2) as total_charge,
    coalesce(m.patient_responsibility_amount, 0)::numeric(12,2) as patient_responsibility,
    coalesce(m.payer_responsibility_amount, 0)::numeric(12,2) as payer_paid,
    m.denial_reason_code,
    m.denial_reason_description,
    m.appeal_deadline_date,
    m.correction_status,
    m.correction_type,
    m.billing_notes,
    m.submitted_at,
    m.created_at,
    coalesce(sl.procedure_code, '—') as cpt_code,
    m.total_count::bigint as total_count
  from matched m
  left join lateral (
    select l.procedure_code
    from public.professional_claim_service_lines l
    where l.organization_id = p_organization_id
      and l.claim_id = m.id
      and l.archived_at is null
    order by l.line_number asc
    limit 1
  ) sl on true
  order by m.created_at desc;
$$;

revoke all on function public.billing_denied_claims_page(uuid, text, uuid[], integer, integer) from public;
revoke all on function public.billing_denied_claims_page(uuid, text, uuid[], integer, integer) from authenticated, anon;
grant execute on function public.billing_denied_claims_page(uuid, text, uuid[], integer, integer) to service_role;

select pg_notify('pgrst', 'reload schema');
