create or replace function public.eligibility_270_candidates_for_month(
  p_organization_id uuid,
  p_month_start date,
  p_month_end date
)
returns table(
  appointment_id uuid,
  client_id uuid,
  insurance_policy_id uuid,
  payer_id uuid,
  payer_name text,
  electronic_payer_id text,
  service_date date,
  client_first_name text,
  client_last_name text,
  client_dob date,
  subscriber_first_name text,
  subscriber_last_name text,
  subscriber_dob date,
  subscriber_member_id text,
  relationship_to_client text,
  provider_id uuid,
  provider_name text,
  already_checked boolean
)
language sql
stable
as $function$
  with scheduled as (
    select distinct on (a.client_id, a.insurance_policy_id)
      a.id as appointment_id,
      a.organization_id,
      a.client_id,
      a.insurance_policy_id,
      a.provider_id,
      a.scheduled_start_at::date as service_date
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.archived_at is null
      and a.insurance_policy_id is not null
      and a.scheduled_start_at >= p_month_start
      and a.scheduled_start_at < p_month_end
      and lower(a.appointment_status::text) not in ('cancelled','canceled','no_show','no-show')
    order by a.client_id, a.insurance_policy_id, a.scheduled_start_at
  )
  select
    s.appointment_id,
    s.client_id,
    s.insurance_policy_id,
    ip.payer_id,
    pay.payer_name,
    pay.payer_id as electronic_payer_id,
    s.service_date,
    c.first_name as client_first_name,
    c.last_name as client_last_name,
    c.date_of_birth as client_dob,
    sub.first_name as subscriber_first_name,
    sub.last_name as subscriber_last_name,
    sub.date_of_birth as subscriber_dob,
    coalesce(sub.member_id, ip.policy_number) as subscriber_member_id,
    coalesce(ip.subscriber_relationship, sub.relationship_to_client) as relationship_to_client,
    s.provider_id,
    coalesce(pr.display_name, concat_ws(' ', pr.first_name, pr.last_name)) as provider_name,
    false as already_checked
  from scheduled s
  join public.clients c on c.id = s.client_id
  join public.insurance_policies ip on ip.id = s.insurance_policy_id
  join public.insurance_subscribers sub on sub.id = ip.subscriber_id
  join public.insurance_payers pay on pay.id = ip.payer_id
  left join public.providers pr on pr.id = s.provider_id
  where not exists (
      select 1
      from public.eligibility_checks ec
      where ec.organization_id = s.organization_id
        and ec.archived_at is null
        and (
          ec.appointment_id = s.appointment_id
          or (
            ec.client_id = s.client_id
            and ec.insurance_policy_id = s.insurance_policy_id
            and ec.checked_at >= p_month_start
            and ec.checked_at < p_month_end
          )
        )
    )
  order by s.service_date, c.last_name, c.first_name;
$function$;
