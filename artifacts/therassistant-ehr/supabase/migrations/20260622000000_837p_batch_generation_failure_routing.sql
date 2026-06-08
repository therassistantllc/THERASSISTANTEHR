-- Task #694 — auto-route 837P batches stuck in `ready_to_generate` back to
-- a biller's queue when the 837P validator (run during Generate / Bulk
-- Batch) fails.
--
-- Two pieces of state are missing from `claim_837p_batches`:
--
--   1. WHO created the batch. The current row only tracks
--      `assigned_to_user_id`, which is set by the Transmission Failures
--      escalation flow — there is no record of the biller who clicked
--      Generate or Bulk Batch. Without it we cannot route an orphaned
--      generation failure back to the originating biller.
--
--   2. WHY the last generation attempt failed. The validator error is
--      currently returned only to the HTTP caller; if the page is closed
--      or the bulk-batch fan-out lands on the 422 path, the failure is
--      effectively lost and the batch sits silently in
--      `ready_to_generate`. We need to persist the error so the new
--      orphaned-batches workqueue can list it and show a Retry button.
--
-- Adding these as nullable columns keeps every existing batch row valid
-- without a backfill.

alter table public.claim_837p_batches
  add column if not exists created_by_user_id uuid,
  add column if not exists created_by_display_name text,
  add column if not exists last_generation_error text,
  add column if not exists last_generation_error_detail jsonb,
  add column if not exists last_generation_attempted_at timestamptz;

-- Partial index: only batches in ready_to_generate WITH a persisted
-- error matter for the orphaned-batches workqueue. The expected row
-- count is small (failures, not the full batch history), so a tight
-- partial index keeps the queue snappy without bloating writes on the
-- happy path.
create index if not exists claim_837p_batches_orphaned_idx
  on public.claim_837p_batches (organization_id, last_generation_attempted_at desc)
  where batch_status = 'ready_to_generate'
    and last_generation_error is not null;

-- Routing index: "show me MY orphaned batches" — the My Inbox-style
-- filter on the new queue narrows by created_by_user_id, so a partial
-- index on the same predicate keeps that view cheap.
create index if not exists claim_837p_batches_orphaned_by_creator_idx
  on public.claim_837p_batches (organization_id, created_by_user_id, last_generation_attempted_at desc)
  where batch_status = 'ready_to_generate'
    and last_generation_error is not null;

select pg_notify('pgrst', 'reload schema');
