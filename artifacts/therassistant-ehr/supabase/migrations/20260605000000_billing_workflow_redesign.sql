-- Billing workflow redesign: rename pages, deferred follow-up, claim notes,
-- appeal letter templates, write-offs, fax number on payers.
--
-- Adds new columns and tables that back the new "Charges / No Response /
-- Denials" workflow. No existing columns are dropped.

-- 1) Payer fax number (for fax-based appeals to payers)
alter table public.insurance_payers
  add column if not exists fax_number text;

-- 2) Defer / snooze on a claim itself (in addition to workqueue_items)
--    Used by both "No Response" and "Denials" follow-up flow.
alter table public.professional_claims
  add column if not exists defer_until date,
  add column if not exists deferred_reason text;

-- 3) Write-off fields on a claim
alter table public.professional_claims
  add column if not exists write_off_amount numeric(12,2),
  add column if not exists write_off_reason text,
  add column if not exists write_off_comment text,
  add column if not exists write_off_at timestamptz,
  add column if not exists write_off_by_user_id uuid references auth.users(id);

create index if not exists idx_professional_claims_defer_until
  on public.professional_claims (organization_id, defer_until)
  where defer_until is not null and archived_at is null;

-- 4) Claim notes (per-claim free-text notes with optional defer date)
create table if not exists public.claim_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.professional_claims(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  author_display_name text,
  body text not null,
  defer_until date,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_notes_claim_id
  on public.claim_notes (claim_id, created_at desc);
create index if not exists idx_claim_notes_org_id
  on public.claim_notes (organization_id, created_at desc);

alter table public.claim_notes enable row level security;

drop policy if exists "claim_notes_tenant_read" on public.claim_notes;
create policy "claim_notes_tenant_read" on public.claim_notes
  for select using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

drop policy if exists "claim_notes_tenant_write" on public.claim_notes;
create policy "claim_notes_tenant_write" on public.claim_notes
  for insert with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

-- 5) Appeal letter templates (system-seeded + org-custom)
create table if not exists public.claim_appeal_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  body text not null,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_claim_appeal_templates_lookup
  on public.claim_appeal_templates (organization_id, archived_at);

alter table public.claim_appeal_templates enable row level security;

drop policy if exists "appeal_templates_read" on public.claim_appeal_templates;
create policy "appeal_templates_read" on public.claim_appeal_templates
  for select using (
    is_system = true
    or organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

drop policy if exists "appeal_templates_write" on public.claim_appeal_templates;
create policy "appeal_templates_write" on public.claim_appeal_templates
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

-- Seed three system-level appeal templates (visible to all orgs)
insert into public.claim_appeal_templates (organization_id, name, body, is_system)
select
  null,
  t.name,
  t.body,
  true
from (values
  (
    'Medical Necessity Appeal',
    E'[Date]\n\n[Payer Name]\nAppeals Department\n[Payer Claims Address]\n\nRE: Appeal of Claim Denial\nPatient: [Patient Name]\nMember ID: [Member ID]\nDate(s) of Service: [DOS]\nClaim Number: [Claim Number]\nDenial Reason: [Denial Reason]\n\nDear Appeals Reviewer,\n\nWe are writing to formally appeal the denial of the above-referenced claim. The services billed were medically necessary based on the patient''s clinical presentation and the standard of care for [Diagnosis].\n\nThe treatment plan, documented in the attached clinical record, supports continued care under the patient''s coverage. We respectfully request that you reconsider this denial and process the claim for payment.\n\nEnclosed: clinical notes, treatment plan, supporting documentation.\n\nSincerely,\n[Provider Name], [Credentials]\n[Practice Name]'
  ),
  (
    'Timely Filing Appeal',
    E'[Date]\n\n[Payer Name]\nAppeals Department\n[Payer Claims Address]\n\nRE: Timely Filing Appeal\nPatient: [Patient Name]\nMember ID: [Member ID]\nDate(s) of Service: [DOS]\nClaim Number: [Claim Number]\n\nDear Appeals Reviewer,\n\nThis claim was originally submitted on [Original Submission Date], which is within the [N]-day timely filing window for this payer. Enclosed is proof of timely submission ([clearinghouse confirmation / submission report]).\n\nWe respectfully request that the timely-filing denial be reversed and the claim processed for payment.\n\nSincerely,\n[Provider Name], [Credentials]\n[Practice Name]'
  ),
  (
    'Coverage Determination Appeal',
    E'[Date]\n\n[Payer Name]\nAppeals Department\n[Payer Claims Address]\n\nRE: Appeal of Coverage Determination\nPatient: [Patient Name]\nMember ID: [Member ID]\nDate(s) of Service: [DOS]\nClaim Number: [Claim Number]\nDenial Reason: [Denial Reason]\n\nDear Appeals Reviewer,\n\nWe respectfully appeal the coverage determination made on the above-referenced claim. Per the member''s benefit plan effective [Effective Date], the services billed are a covered benefit.\n\nWe request that this claim be reprocessed under the correct benefit category. Supporting documentation including the member''s eligibility verification and benefit summary is enclosed.\n\nSincerely,\n[Provider Name], [Credentials]\n[Practice Name]'
  )
) as t(name, body)
where not exists (
  select 1 from public.claim_appeal_templates
  where is_system = true and name = t.name
);

-- 6) Fax queue (no fax provider integration yet — queue rows are created
--    by the UI and remain status='pending' until a downstream worker picks
--    them up). Surfaces in the Denials page as "N faxes pending".
create table if not exists public.fax_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid references public.professional_claims(id) on delete set null,
  payer_id uuid references public.insurance_payers(id) on delete set null,
  to_fax_number text not null,
  subject text,
  body text not null,
  status text not null default 'pending',
  error text,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_fax_queue_pending
  on public.fax_queue (organization_id, status, created_at desc);

alter table public.fax_queue enable row level security;

drop policy if exists "fax_queue_tenant" on public.fax_queue;
create policy "fax_queue_tenant" on public.fax_queue
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
