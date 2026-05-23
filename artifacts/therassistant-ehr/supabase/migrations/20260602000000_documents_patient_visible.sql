-- Track whether a document may be shown to the patient via the portal.
-- Defaults to false so existing rows stay private until staff explicitly opt them in.
alter table public.documents
  add column if not exists patient_visible boolean not null default false;

create index if not exists idx_documents_patient_visible
  on public.documents (organization_id, client_id, created_at desc)
  where patient_visible = true and archived_at is null;
