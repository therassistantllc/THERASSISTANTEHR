-- One-time targeted backfill for the five existing active charge_capture_items
-- rows that were captured before provider_credentialing_profile_id was set.
--
-- Rules:
--   1. Only active charges are considered (archived_at is null and not voided).
--   2. Only active, unarchived credentialing profiles in the same organization
--      are eligible (is_active = true and archived_at is null).
--   3. If an organization has exactly one eligible credentialing profile, use it.
--   4. If an organization has multiple eligible profiles, do not infer from
--      provider_id. Add an explicit charge-id-to-profile-id row below.

create temp table charge_capture_provider_profile_backfill_map (
  charge_capture_item_id uuid primary key,
  provider_credentialing_profile_id uuid not null
) on commit drop;

-- Explicit mappings for organizations with multiple active credentialing profiles.
-- Keep this intentionally empty unless the five target charges include an
-- organization with more than one active profile. When needed, add one row per
-- affected charge using provider_credentialing_profiles.id as the source value:
--
-- insert into charge_capture_provider_profile_backfill_map (
--   charge_capture_item_id,
--   provider_credentialing_profile_id
-- ) values
--   ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000');

do $$
declare
  v_candidate_count integer;
  v_single_profile_updates integer := 0;
  v_explicit_map_updates integer := 0;
  v_invalid_map_count integer := 0;
  v_remaining_count integer := 0;
begin
  if to_regclass('public.charge_capture_items') is null then
    raise notice 'Skipping charge credentialing profile backfill: public.charge_capture_items does not exist.';
    return;
  end if;

  if to_regclass('public.provider_credentialing_profiles') is null then
    raise notice 'Skipping charge credentialing profile backfill: public.provider_credentialing_profiles does not exist.';
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charge_capture_items'
      and column_name = 'provider_credentialing_profile_id'
  ) then
    raise notice 'Skipping charge credentialing profile backfill: charge_capture_items.provider_credentialing_profile_id does not exist.';
    return;
  end if;

  drop table if exists pg_temp.charge_capture_provider_profile_backfill_targets;
  create temp table charge_capture_provider_profile_backfill_targets (
    id uuid primary key
  ) on commit drop;

  insert into charge_capture_provider_profile_backfill_targets (id)
  select cci.id
  from public.charge_capture_items cci
  where cci.provider_credentialing_profile_id is null
    and cci.archived_at is null
    and cci.charge_status <> 'voided';

  select count(*)
    into v_candidate_count
  from charge_capture_provider_profile_backfill_targets;

  if v_candidate_count = 0 then
    raise notice 'No active charge_capture_items rows require provider_credentialing_profile_id backfill.';
    return;
  end if;

  if v_candidate_count <> 5 then
    raise exception 'Expected exactly 5 active charge_capture_items rows missing provider_credentialing_profile_id, found %; refusing broad backfill.', v_candidate_count
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_invalid_map_count
  from charge_capture_provider_profile_backfill_map m
  left join public.charge_capture_items cci
    on cci.id = m.charge_capture_item_id
   and cci.archived_at is null
   and cci.charge_status <> 'voided'
  left join public.provider_credentialing_profiles pcp
    on pcp.id = m.provider_credentialing_profile_id
   and pcp.organization_id = cci.organization_id
   and pcp.is_active is true
   and pcp.archived_at is null
  where cci.id is null
     or pcp.id is null;

  if v_invalid_map_count > 0 then
    raise exception 'Explicit charge_capture_provider_profile_backfill_map contains % invalid row(s); mappings must target active charges and active unarchived credentialing profiles in the same organization.', v_invalid_map_count
      using errcode = 'P0001';
  end if;

  with active_profiles_by_org as (
    select
      pcp.organization_id,
      count(*) as active_profile_count,
      (array_agg(pcp.id order by pcp.id))[1] as provider_credentialing_profile_id
    from public.provider_credentialing_profiles pcp
    where pcp.is_active is true
      and pcp.archived_at is null
    group by pcp.organization_id
  )
  update public.charge_capture_items cci
     set provider_credentialing_profile_id = ap.provider_credentialing_profile_id,
         updated_at = now()
  from charge_capture_provider_profile_backfill_targets t
  join active_profiles_by_org ap
    on ap.active_profile_count = 1
  where cci.id = t.id
    and cci.organization_id = ap.organization_id
    and cci.provider_credentialing_profile_id is null
    and cci.archived_at is null
    and cci.charge_status <> 'voided';

  get diagnostics v_single_profile_updates = row_count;

  update public.charge_capture_items cci
     set provider_credentialing_profile_id = m.provider_credentialing_profile_id,
         updated_at = now()
  from charge_capture_provider_profile_backfill_targets t
  join charge_capture_provider_profile_backfill_map m
    on m.charge_capture_item_id = t.id
  join public.provider_credentialing_profiles pcp
    on pcp.id = m.provider_credentialing_profile_id
   and pcp.is_active is true
   and pcp.archived_at is null
  where cci.id = t.id
    and pcp.organization_id = cci.organization_id
    and cci.provider_credentialing_profile_id is null
    and cci.archived_at is null
    and cci.charge_status <> 'voided';

  get diagnostics v_explicit_map_updates = row_count;

  select count(*)
    into v_remaining_count
  from public.charge_capture_items cci
  join charge_capture_provider_profile_backfill_targets t
    on t.id = cci.id
  where cci.provider_credentialing_profile_id is null
    and cci.archived_at is null
    and cci.charge_status <> 'voided';

  if v_remaining_count > 0 then
    raise exception 'Provider credentialing profile backfill left % target charge(s) unset. Add explicit charge-id-to-profile-id mappings for organizations with multiple active credentialing profiles.', v_remaining_count
      using errcode = 'P0001';
  end if;

  raise notice 'Backfilled charge_capture_items.provider_credentialing_profile_id for % single-profile charge(s) and % explicitly mapped charge(s).',
    v_single_profile_updates,
    v_explicit_map_updates;
end $$;
