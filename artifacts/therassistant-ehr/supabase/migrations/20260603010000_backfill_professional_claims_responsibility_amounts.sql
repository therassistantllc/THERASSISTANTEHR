-- One-time backfill of patient_responsibility_amount and
-- payer_responsibility_amount on professional_claims (Task #302).
--
-- The columns were added in 20260603000000 with a default of 0. Any
-- professional_claims row that already had payments posted against it via
-- the manual insurance path (insurance_manual_payments) or the ERA 835 path
-- (era_claim_payments) before that migration ran would therefore read as
-- "0 patient responsibility" even though real PR was recorded on the
-- posting rows. The patient-payment posting engine reads
-- patient_responsibility_amount to cap how much of a patient payment can
-- be applied to a claim; with a stale 0, all of the payment would spill
-- into the unapplied-credit bucket instead of decrementing the claim's PR.
--
-- This migration recomputes both columns for every existing claim from
-- the posted payment history:
--
--   patient_responsibility_amount
--     = sum of PR posted by manual EOBs + sum of PR posted by ERA 835s
--       minus sum of patient payments already applied to the claim
--       (payment_applications.payment_kind='client'), clamped at 0.
--
--   payer_responsibility_amount
--     = total_charge minus sum of payer payments (manual paid + ERA paid)
--       minus sum of contractual adjustments recorded on manual EOBs,
--       clamped at 0. This mirrors how /api/payments/insurance decrements
--       the column on each new posting.
--
-- Only posted, non-archived posting rows are considered. ERA rows that
-- never matched a claim (professional_claim_id IS NULL) are skipped.
-- Claims with no posting history end up with payer_responsibility =
-- total_charge and patient_responsibility = 0, which matches the
-- "nothing has been adjudicated yet" semantic used by new postings.

with manual as (
  select claim_id,
         coalesce(sum(paid_amount), 0)                   as paid,
         coalesce(sum(adjustment_amount), 0)             as adj,
         coalesce(sum(patient_responsibility_amount), 0) as pr
    from public.insurance_manual_payments
   where archived_at is null
     and posting_status = 'posted'
   group by claim_id
),
era as (
  select professional_claim_id as claim_id,
         coalesce(sum(clp04_payment_amount), 0)         as paid,
         coalesce(sum(clp05_patient_responsibility), 0) as pr
    from public.era_claim_payments
   where archived_at is null
     and posting_status = 'posted'
     and professional_claim_id is not null
   group by professional_claim_id
),
patient_paid as (
  select claim_id,
         coalesce(sum(applied_amount), 0) as applied
    from public.payment_applications
   where archived_at is null
     and payment_kind = 'client'
     and claim_id is not null
   group by claim_id
),
agg as (
  select base.id                              as claim_id,
         coalesce(base.total_charge, 0)       as total_charge,
         coalesce(m.paid, 0)                  as manual_paid,
         coalesce(m.adj, 0)                   as manual_adj,
         coalesce(m.pr, 0)                    as manual_pr,
         coalesce(e.paid, 0)                  as era_paid,
         coalesce(e.pr, 0)                    as era_pr,
         coalesce(pp.applied, 0)              as patient_applied
    from public.professional_claims base
    left join manual       m  on m.claim_id  = base.id
    left join era          e  on e.claim_id  = base.id
    left join patient_paid pp on pp.claim_id = base.id
)
update public.professional_claims pc
   set patient_responsibility_amount = greatest(
         0,
         round((agg.manual_pr + agg.era_pr - agg.patient_applied)::numeric, 2)
       ),
       payer_responsibility_amount = greatest(
         0,
         round((agg.total_charge - agg.manual_paid - agg.manual_adj - agg.era_paid)::numeric, 2)
       ),
       updated_at = now()
  from agg
 where pc.id = agg.claim_id;

select pg_notify('pgrst', 'reload schema');
