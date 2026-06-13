create or replace function public.resolve_837p_settings_for_claim(p_claim_id uuid)
returns table (
  claim_id uuid,
  organization_id uuid,
  appointment_id uuid,
  provider_id uuid,
  rendering_npi text,
  practice_name text,
  practice_tax_id text,
  group_npi text,
  taxonomy_code text,
  submitter_id text,
  sftp_username text,
  sftp_host text,
  sftp_port integer,
  payer_profile_id uuid,
  payer_name text,
  payer_id text
)
language sql
stable
as $$
  select
    pc.id as claim_id,
    pc.organization_id,
    pc.appointment_id,
    coalesce(pc.provider_credentialing_profile_id, a.provider_credentialing_profile_id, a.provider_id) as provider_id,
    regexp_replace(
      coalesce(supervisor.individual_npi, supervisor.group_npi, pcp.individual_npi, pcp.group_npi, ''),
      '\D',
      '',
      'g'
    ) as rendering_npi,
    pcp.practice_name,
    regexp_replace(coalesce(pcp.practice_tax_id, ''), '\D', '', 'g') as practice_tax_id,
    regexp_replace(coalesce(pcp.group_npi, pcp.individual_npi, ''), '\D', '', 'g') as group_npi,
    pcp.taxonomy_code as taxonomy_code,
    pcp.availity_submitter_id as submitter_id,
    pcp.availity_sftp_username as sftp_username,
    pcp.availity_sftp_host as sftp_host,
    pcp.availity_sftp_port as sftp_port,
    pc.payer_profile_id,
    pp.payer_name,
    pp.availity_payer_id as payer_id
  from public.professional_claims pc
  left join public.appointments a
    on a.id = pc.appointment_id
   and a.organization_id = pc.organization_id
   and a.archived_at is null
  join public.provider_credentialing_profiles pcp
    on pcp.id = coalesce(pc.provider_credentialing_profile_id, a.provider_credentialing_profile_id, a.provider_id)
   and pcp.organization_id = pc.organization_id
   and pcp.archived_at is null
   and pcp.is_active = true
  left join public.provider_credentialing_profiles supervisor
    on supervisor.id = pcp."Supervisor"
   and supervisor.organization_id = pc.organization_id
   and supervisor.archived_at is null
   and supervisor.is_active = true
  left join public.payer_profiles pp
    on pp.id = pc.payer_profile_id
   and pp.organization_id = pc.organization_id
  where pc.id = p_claim_id
  limit 1;
$$;
