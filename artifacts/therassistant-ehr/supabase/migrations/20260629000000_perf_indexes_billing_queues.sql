-- Performance indexes for high-traffic roster and billing queue routes.

create index if not exists idx_claim_837p_batches_charge_auto_created
  on public.claim_837p_batches (organization_id, created_at desc, id)
  where archived_at is null and batch_source = 'charge_auto';

create index if not exists idx_prof_claims_ready_for_batch_created
  on public.professional_claims (organization_id, created_at asc, id)
  where archived_at is null and claim_status = 'ready_for_batch';

create index if not exists idx_prof_claims_denied_updated
  on public.professional_claims (organization_id, updated_at desc, id)
  where archived_at is null and claim_status = 'denied';

create index if not exists idx_clients_org_active_name
  on public.clients (organization_id, last_name, first_name, id)
  where archived_at is null;

create index if not exists idx_patient_invoices_org_client_open
  on public.patient_invoices (organization_id, client_id, invoice_status)
  where archived_at is null and invoice_status in ('open', 'sent', 'collections');

create index if not exists idx_eligibility_checks_org_client_checked
  on public.eligibility_checks (organization_id, client_id, checked_at desc)
  where archived_at is null;

create index if not exists idx_appointments_org_client_start_active
  on public.appointments (organization_id, client_id, scheduled_start_at)
  where archived_at is null;

create index if not exists idx_workqueue_items_org_client_open
  on public.workqueue_items (organization_id, client_id, status)
  where archived_at is null and status in ('open', 'in_progress', 'blocked');

select pg_notify('pgrst', 'reload schema');
