-- Run this ONCE in the Supabase SQL editor:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Before running, replace <SERVICE_ROLE_JWT> with the service-role key from
--   Dashboard -> Project Settings -> API -> service_role  (the long JWT, NOT the sbp_ token).
--
-- This schedules gmail-poll-inbox to run every 2 minutes. Adjust the cron expression
-- as desired ('*/5 * * * *' for every 5 min, etc.).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior schedule with this name before re-creating.
do $$
declare j_id bigint;
begin
  select jobid into j_id from cron.job where jobname = 'gmail-poll-inbox-every-2min';
  if j_id is not null then
    perform cron.unschedule(j_id);
  end if;
end $$;

select cron.schedule(
  'gmail-poll-inbox-every-2min',
  '*/2 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://btsbmozbggjllpcsuyyy.functions.supabase.co/gmail-poll-inbox',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_JWT>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- Verify:
--   select jobname, schedule, command from cron.job where jobname = 'gmail-poll-inbox-every-2min';
-- Recent runs:
--   select * from cron.job_run_details order by start_time desc limit 10;
