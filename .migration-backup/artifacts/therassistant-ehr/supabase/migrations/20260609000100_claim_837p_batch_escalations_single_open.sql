-- Enforce one open escalation per batch (Task #443 follow-up).
-- The API resolves/cancels prior open rows before inserting a new one, but
-- a partial unique index makes the invariant atomic at the DB layer so two
-- racing reassigns can't both succeed.

create unique index if not exists uq_claim_837p_batch_escalations_one_open
  on public.claim_837p_batch_escalations (batch_id)
  where status = 'open';

notify pgrst, 'reload schema';
