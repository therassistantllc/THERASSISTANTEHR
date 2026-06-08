-- Corrected Claim queue support (Task #367)
--
-- Adds columns on professional_claims to track the relationship between an
-- original (denied/rejected) claim and a corrected claim built to replace or
-- void it, plus the lifecycle of that correction.
--
-- A "corrected" claim is a child row in professional_claims:
--   * original_claim_id  → the prior claim being corrected
--   * correction_type    → 'replacement' (frequency 7) or 'void' (frequency 8)
--   * correction_status  → 'pending' | 'ready' | 'sent'
--   * correction_reason  → free-text reason captured at creation time
--   * correction_sent_at → timestamp the corrected claim was transmitted
--
-- The "Corrected Claim Needed" tab is derived: it lists denied / payer-
-- rejected / OA-rejected originals that do NOT yet have any child correction
-- row (and were not dismissed via a CORRECTION_DISMISS:<orig> claim_notes
-- marker — same pattern Duplicate Claim Review uses).

alter table public.professional_claims
  add column if not exists original_claim_id uuid
    references public.professional_claims(id) on delete set null,
  add column if not exists correction_type text,
  add column if not exists correction_status text,
  add column if not exists correction_reason text,
  add column if not exists correction_sent_at timestamptz;

alter table public.professional_claims
  drop constraint if exists professional_claims_correction_type_check;
alter table public.professional_claims
  add constraint professional_claims_correction_type_check
  check (
    correction_type is null or correction_type = any (array['replacement','void'])
  );

alter table public.professional_claims
  drop constraint if exists professional_claims_correction_status_check;
alter table public.professional_claims
  add constraint professional_claims_correction_status_check
  check (
    correction_status is null or correction_status = any (array['pending','ready','sent'])
  );

create index if not exists idx_professional_claims_original_claim_id
  on public.professional_claims (original_claim_id)
  where original_claim_id is not null;

create index if not exists idx_professional_claims_correction_status
  on public.professional_claims (organization_id, correction_status)
  where correction_status is not null and archived_at is null;

notify pgrst, 'reload schema';
