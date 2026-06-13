alter table public.clearinghouse_connections
  add column if not exists isa_sender_id text,
  add column if not exists application_sender_code text;

alter table public.provider_credentialing_profiles
  add column if not exists availity_isa_sender_id text,
  add column if not exists availity_application_sender_code text;

update public.clearinghouse_connections
set
  isa_sender_id = 'AV09311993',
  application_sender_code = '1082546',
  submitter_id = 'AV09311993',
  sender_qualifier = 'ZZ',
  receiver_qualifier = '01',
  receiver_id = '030240928',
  gs_receiver_code = '030240928',
  updated_at = now()
where organization_id = '11111111-1111-1111-1111-111111111111'
  and vendor = 'availity'
  and practice_name = 'Conscious Counseling PLLC'
  and is_active = true;

update public.provider_credentialing_profiles
set
  availity_isa_sender_id = 'AV09311993',
  availity_application_sender_code = '1082546',
  updated_at = now()
where organization_id = '11111111-1111-1111-1111-111111111111'
  and practice_name = 'Conscious Counseling PLLC'
  and archived_at is null;

select pg_notify('pgrst', 'reload schema');
