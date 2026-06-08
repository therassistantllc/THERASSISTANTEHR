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
-- This schedules the autopay-retry sweep (Task #669). The route re-runs
-- `attemptAutopayForInvoice` for invoices whose most recent autopay
-- attempt failed and whose backoff window has elapsed (default 1d / 3d /
-- 7d, max 3 retries). The route itself fans out across every
-- organization that has a recent autopay_failed audit event, so this
-- schedule does not need to know about org IDs.
--
-- Cadence: 13:00 UTC daily (~early morning PT). Retries are gated by the
-- per-invoice backoff window, so running daily simply means each invoice
-- gets its retry on the first daily run after the window opens.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior schedule with this name before re-creating.
do $$
declare j_id bigint;
begin
  select jobid into j_id from cron.job where jobname = 'patient-billing-autopay-retry-daily';
  if j_id is not null then
    perform cron.unschedule(j_id);
  end if;
end $$;

select cron.schedule(
  'patient-billing-autopay-retry-daily',
  '0 13 * * *',
  $cron$
    select net.http_post(
      url     := '<APP_BASE_URL>/api/billing/patient-billing/cron/autopay-retry',
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
--   select jobname, schedule, command from cron.job where jobname = 'patient-billing-autopay-retry-daily';
-- Recent runs:
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'patient-billing-autopay-retry-daily')
--     order by start_time desc limit 10;
