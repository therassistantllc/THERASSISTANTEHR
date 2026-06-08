-- 837P submission transport: idempotency, external transaction tracking, retry bookkeeping.
-- Wires the previously stubbed submit endpoint to actually call Office Ally and persist the result.

alter table public.claim_837p_batches
  add column if not exists submission_idempotency_key text,
  add column if not exists office_ally_transaction_id text,
  add column if not exists submission_error text,
  add column if not exists submission_attempt_count integer not null default 0,
  add column if not exists last_submission_attempted_at timestamptz,
  add column if not exists last_submission_endpoint text,
  add column if not exists last_submission_http_status integer;

create unique index if not exists idx_claim_837p_batches_idempotency_key
  on public.claim_837p_batches (submission_idempotency_key)
  where submission_idempotency_key is not null;

select pg_notify('pgrst', 'reload schema');
