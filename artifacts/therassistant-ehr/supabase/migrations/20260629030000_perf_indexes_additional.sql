-- Additional composite indexes for high-volume operational queries.

create index if not exists idx_prof_claims_org_status_archived
  on public.professional_claims (organization_id, claim_status, id)
  where archived_at is null;

create index if not exists idx_prof_claims_org_patient_archived
  on public.professional_claims (organization_id, patient_id, id)
  where archived_at is null;

create index if not exists idx_appointments_org_start_archived
  on public.appointments (organization_id, scheduled_start_at, id)
  where archived_at is null;

create index if not exists idx_appointments_org_client_start_archived
  on public.appointments (organization_id, client_id, scheduled_start_at)
  where archived_at is null;

create index if not exists idx_workqueue_org_status_archived
  on public.workqueue_items (organization_id, status, updated_at desc)
  where archived_at is null;

create index if not exists idx_workqueue_org_prof_claim_archived
  on public.workqueue_items (organization_id, professional_claim_id)
  where archived_at is null;

create index if not exists idx_claim_837p_batch_claims_org_claim_archived
  on public.claim_837p_batch_claims (organization_id, professional_claim_id, batch_id)
  where archived_at is null;

select pg_notify('pgrst', 'reload schema');
