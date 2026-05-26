-- Cron job heartbeat ledger.
--
-- Generalizes the silent-failure detection previously only available for
-- the claim-status auto-check (which had its own implicit heartbeat via
-- claim_status_inquiries.trigger_source='auto'). Every nightly /
-- scheduled job in `lib/cron/jobRegistry.ts` writes a row here when it
-- finishes — success OR error — so a single registry-driven heartbeat
-- endpoint can answer "is each cron still running?" for every job.
--
-- Why a dedicated table instead of overloading audit_logs:
--   - audit_logs is keyed per-organization and per-domain object; a
--     scheduled global fan-out across orgs doesn't fit cleanly.
--   - We want a probe that's fast (single index seek) regardless of
--     how chatty the rest of the audit_logs traffic is.
--   - "Job ran but did nothing" is a valid success — we can't infer it
--     from the absence of side-effects elsewhere.
--
-- organization_id is nullable: cron fan-out runs across every org may
-- record a single "global" row; per-org manual catch-up runs record a
-- scoped row. The heartbeat probe reads MAX(finished_at) regardless.

create table if not exists public.cron_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  status text not null check (status in ('success', 'error')),
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  error_message text
);

create index if not exists cron_job_runs_job_finished_idx
  on public.cron_job_runs (job_id, finished_at desc);

create index if not exists cron_job_runs_job_status_finished_idx
  on public.cron_job_runs (job_id, status, finished_at desc);

create index if not exists cron_job_runs_job_org_finished_idx
  on public.cron_job_runs (job_id, organization_id, finished_at desc);

-- Refresh PostgREST so the new table is queryable via supabase-js.
notify pgrst, 'reload schema';
