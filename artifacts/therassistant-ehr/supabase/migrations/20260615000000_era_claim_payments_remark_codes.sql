-- Task #561 — Persist parsed ERA remark codes on era_claim_payments so the
-- Medical Review, Denials-by-RARC, and Payer Received detail panels don't
-- have to re-parse `raw_segments` on every read.
--
-- `carc_codes` / `rarc_codes` already exist (added in
-- 20260515000000_ehr_billing_foundation.sql) but the 835 intake never wrote
-- to them. This migration adds a structured `remark_codes` jsonb column
-- holding the parser's raw remark-code list (LQ*HE + MIA/MOA sweep) and
-- documents it; the intake service is updated separately to populate
-- carc_codes / rarc_codes / remark_codes on insert.

alter table public.era_claim_payments
  add column if not exists remark_codes jsonb not null default '[]'::jsonb;

comment on column public.era_claim_payments.remark_codes is
  'Structured remark codes parsed from the 835 (LQ*HE qualifier, MIA20-23, MOA03-07). Array of {code, source} entries. Mirrors `rarc_codes` text[] for quick filtering but preserves source context. Task #561.';

create index if not exists idx_era_claim_payments_remark_codes_gin
  on public.era_claim_payments using gin (remark_codes);

select pg_notify('pgrst', 'reload schema');
