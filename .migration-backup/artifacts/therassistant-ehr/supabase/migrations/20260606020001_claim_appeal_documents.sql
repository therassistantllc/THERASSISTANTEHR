-- Supporting documents uploaded against a claim appeal (Task #472).
--
-- Before this table the "Attach documents" action on /billing/appeals just
-- bumped an integer counter and wrote a claim note — the actual PDFs lived
-- outside the system. Billers now upload progress notes, treatment plans,
-- prior-auth letters etc. directly against the appeal, and the row here
-- carries the storage pointer + audit metadata. attachments_count on
-- claim_appeals is derived from this table at read time.

create table if not exists public.claim_appeal_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appeal_id uuid not null references public.claim_appeals(id) on delete cascade,
  claim_id uuid not null references public.professional_claims(id) on delete cascade,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text not null,
  storage_path text not null,
  description text,
  uploaded_by_user_id uuid references auth.users(id),
  uploaded_by_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_appeal_documents_appeal
  on public.claim_appeal_documents (appeal_id, created_at desc);
create index if not exists idx_claim_appeal_documents_org_claim
  on public.claim_appeal_documents (organization_id, claim_id, created_at desc);

alter table public.claim_appeal_documents enable row level security;

drop policy if exists "claim_appeal_documents_tenant" on public.claim_appeal_documents;
create policy "claim_appeal_documents_tenant" on public.claim_appeal_documents
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
