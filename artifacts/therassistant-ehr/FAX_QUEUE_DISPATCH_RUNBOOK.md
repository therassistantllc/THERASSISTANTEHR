# Outbound fax-queue dispatch cron

Scheduled worker that drains pending `fax_queue` rows by handing the merged
documentation PDF to the configured outbound fax provider (Telnyx). Backs
the `POST /api/billing/fax-queue/cron/dispatch` route. Mirrors the setup
pattern documented in `CLAIM_STATUS_AUTO_CHECK_RUNBOOK.md` — same
`x-cron-secret` header, same Supabase pg_cron registration, same
manual-run fallback for billers.

## Cadence

- **Schedule:** every 5 minutes (`*/5 * * * *`).
- **Why so frequent:** pending faxes are operator-facing work
  (medical-review "Send documentation" → payer fax). A 5-minute interval
  keeps end-to-end latency tight without overwhelming the provider.
- **Where it's registered:** Supabase pg_cron, via
  `supabase/CRON_SETUP_FAX_QUEUE_DISPATCH.sql`. Run that file once in the
  Supabase SQL editor against the production project after substituting
  `<APP_BASE_URL>` and `<CRON_SECRET>`. The script is idempotent —
  re-running drops and re-creates the schedule by name
  (`billing-fax-queue-dispatch-every-5min`).
- **Safe to overlap:** the worker only picks rows in `status='pending'`
  and atomically claims each one before transmitting, so a manual retry
  racing the cron cannot double-send.

## Required environment

Set on the Next.js production deployment (same place `CRON_SECRET` and
the Supabase service-role keys live):

- `CRON_SECRET` — must match the value embedded in the pg_cron SQL.
- Fax provider credentials, via **either**:
  - Replit Connectors → `telnyx` (`api_key`, `from_number`, optional
    `connection_id`), **or**
  - Env vars: `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`,
    `[TELNYX_CONNECTION_ID]`.

If neither credential source is present the worker flips each scanned row
to `failed` with a clear message instead of leaving it stuck on
`pending`.

## Verifying it ran

In the Supabase SQL editor:

```sql
-- Last 10 cron executions (HTTP status + body live in `return_message`)
select start_time, status, return_message
from cron.job_run_details
where jobid = (
  select jobid from cron.job
  where jobname = 'billing-fax-queue-dispatch-every-5min'
)
order by start_time desc
limit 10;

-- Faxes the worker has touched in the last hour
select id, organization_id, status, last_error, sent_at, updated_at
from fax_queue
where updated_at > now() - interval '1 hour'
order by updated_at desc;
```

The route returns a JSON summary (`{ ok, organizations, totals, perOrg }`)
captured in `cron.job_run_details.return_message`. `totals.sent +
totals.failed` should match the number of `fax_queue` rows that moved out
of `pending` in the same window.

## Troubleshooting

- **Rows stay `pending` forever:** check that the cron job exists
  (`select * from cron.job where jobname =
  'billing-fax-queue-dispatch-every-5min'`) and that `return_message`
  shows HTTP 200. If `return_message` shows 401/403, the `CRON_SECRET`
  embedded in the pg_cron SQL has drifted from the deployment env var —
  re-run `CRON_SETUP_FAX_QUEUE_DISPATCH.sql` with the current secret.
- **All rows immediately flip to `failed` with a "provider not
  configured" / Telnyx credential error:** the Telnyx connector or env
  vars are missing on the deployment. Fix and redeploy; the next cron
  tick will pick up new pending rows (already-failed rows need a biller
  retry from the fax-queue UI).
- **`Database unavailable` (503) in `return_message`:** Supabase
  service-role env vars missing on the Next.js deployment.

## Manual / catch-up run

A biller (admin or biller role) can trigger a one-off run for a single
org without the cron secret — useful after a provider outage:

```bash
curl -X POST "$APP_BASE_URL/api/billing/fax-queue/cron/dispatch" \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"organizationId":"<org-uuid>","maxFaxes":25}'
```

`maxFaxes` is optional — omit it to drain every pending row for the org
in one pass.
