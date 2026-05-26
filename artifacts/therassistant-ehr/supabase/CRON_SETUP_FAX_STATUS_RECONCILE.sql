-- Run this ONCE in the Supabase SQL editor:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Before running, replace:
--   <APP_BASE_URL>  with the deployed Next.js app origin
--                   (e.g. https://therassistant.example.com — no trailing slash)
--   <CRON_SECRET>   with the value of the CRON_SECRET env var set on the
--                   Next.js deployment (the same secret the route checks
--                   via the `x-cron-secret` header).
--
-- This schedules the outbound fax-status reconciler (Task #726). The
-- dispatcher (see CRON_SETUP_FAX_QUEUE_DISPATCH.sql) flips a transmission
-- to 'sending' the moment Telnyx accepts the job — but Telnyx delivery
-- is asynchronous, so the fax can still go busy / no-answer / line-
-- dropped downstream. Without this reconciler the Submission history
-- would sit on "SENDING" forever.
--
-- The route fans out across every organization with at least one
-- non-terminal fax transmission, polls Telnyx for each row's terminal
-- status via the stored provider_message_id, and flips the
-- claim_documentation_transmissions row to 'delivered' or 'failed' with
-- the provider's failure_reason.
--
-- Cadence: every 5 minutes. Telnyx fax delivery usually settles within
-- 30–90s; polling more often is wasteful, polling less often makes the
-- Submission history feel stale. The reconciler is idempotent — it
-- skips terminal rows and skips rows still on the dispatcher placeholder
-- (no sent_at), so overlapping runs are safe.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior schedule with this name before re-creating.
do $$
declare j_id bigint;
begin
  select jobid into j_id from cron.job where jobname = 'billing-fax-status-reconcile-every-5min';
  if j_id is not null then
    perform cron.unschedule(j_id);
  end if;
end $$;

select cron.schedule(
  'billing-fax-status-reconcile-every-5min',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := '<APP_BASE_URL>/api/billing/fax-queue/cron/reconcile-status',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);

-- Verify the schedule:
--   select jobname, schedule, command from cron.job where jobname = 'billing-fax-status-reconcile-every-5min';
-- Recent runs:
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'billing-fax-status-reconcile-every-5min')
--     order by start_time desc limit 10;
