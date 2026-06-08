-- Task #111 (PP-5): make workqueue auto-gen idempotent at the DB level.
--
-- applyWorkqueueRules() previously did a read-then-insert to dedupe open
-- items keyed by (source_object_type, source_object_id, work_type). Two
-- concurrent committer calls for the same payment could both observe
-- "no open item" and both insert -> duplicate workqueue items.
--
-- This partial unique index closes the race. Only open + non-archived
-- rows participate, so a workqueue item can legitimately be re-opened
-- after a prior one is closed/archived. Application code catches the
-- resulting 23505 unique_violation and treats it as a successful dedupe.
do $$
begin
  if to_regclass('public.workqueue_items') is not null then
    create unique index if not exists uq_workqueue_items_open_source_dedupe
      on public.workqueue_items (
        organization_id,
        source_object_type,
        source_object_id,
        work_type
      )
      where status = 'open' and archived_at is null;
  end if;
end $$;
