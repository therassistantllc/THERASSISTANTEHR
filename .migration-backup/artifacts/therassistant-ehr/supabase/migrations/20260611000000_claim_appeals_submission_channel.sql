-- Task #473: record HOW an appeal was actually sent so the queue can
-- distinguish "we queued a fax to the payer" from "we logged that the
-- biller mailed it" from "we marked it submitted via the payer portal".

alter table public.claim_appeals
  add column if not exists submission_channel text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'claim_appeals_submission_channel_chk'
  ) then
    alter table public.claim_appeals
      add constraint claim_appeals_submission_channel_chk
      check (submission_channel is null
             or submission_channel in ('fax', 'portal', 'mail'));
  end if;
end$$;

notify pgrst, 'reload schema';
