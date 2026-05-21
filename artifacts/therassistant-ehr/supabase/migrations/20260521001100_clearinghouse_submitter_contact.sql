-- OA Companion Guide compliance: TR3 005010X222A1 Loop 1000A PER
-- (Submitter EDI Contact Information) requires at least one of TE/EM/FX.
-- Persist phone + email on the clearinghouse connection so the 837P
-- generator can emit a valid PER segment without baking contact info into
-- code or environment variables.
alter table public.clearinghouse_connections
  add column if not exists submitter_contact_phone text,
  add column if not exists submitter_contact_email text;

comment on column public.clearinghouse_connections.submitter_contact_phone is
  'Loop 1000A PER02/TE — submitter EDI contact phone (digits only). Required (with submitter_contact_email as an alternative) for TR3 005010X222A1 syntax compliance.';
comment on column public.clearinghouse_connections.submitter_contact_email is
  'Loop 1000A PER02/EM — submitter EDI contact email. Required (with submitter_contact_phone as an alternative) for TR3 005010X222A1 syntax compliance.';
