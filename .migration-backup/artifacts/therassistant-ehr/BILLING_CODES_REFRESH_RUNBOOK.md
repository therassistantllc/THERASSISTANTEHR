# Billing-Code Refresh Runbook

The scheduled monthly refresh keeps `diagnosis_codes` (ICD-10-CM) and
`procedure_codes` (HCPCS Level II) in sync with CMS. CPT is AMA-licensed and
must be loaded manually with `npm run import:billing-codes -- --cpt …`.

## What runs, and when

| Job | Frequency | Entry point |
|---|---|---|
| `refresh-billing-codes` | Monthly (typically the 16th of each month) | `tsx artifacts/therassistant-ehr/scripts/refresh-billing-codes.ts` |

The script:
1. Downloads `icd10cm-codes-YYYY.txt` and `HCPC<YYYY>_ANWEB.csv` from CMS.
2. Parses each file with the same code path the manual importer uses.
3. Upserts into `diagnosis_codes` / `procedure_codes` (idempotent on
   `(code, code_system)`).
4. **Evaluates the outcome** and fires an alert if anything looks wrong.

## Alerting (what this runbook is here for)

An alert fires when **either**:

- **Error** — a code system errored during download, parse, or upsert. The
  raw error message is captured in the alert.
- **Missing release** — a code system returned 0 rows AND a new release is
  already overdue:
  - **ICD-10-CM** is annual (effective Oct 1). Expected to be downloadable
    by **Oct 15** each year.
  - **HCPCS Level II** is quarterly (effective Jan/Apr/Jul/Oct 1). Expected
    to be downloadable by the **15th of each release month**.
  - **CPT** is never alerted on for "missing" — AMA-licensed, no automated
    download path.

Alerts go out on **two independent channels**:

- **Email via Resend** — recipients come from
  `BILLING_CODES_REFRESH_ALERT_EMAIL` (comma-separated). Requires
  `RESEND_API_KEY`.
- **Workqueue item** — one open `billing_code_refresh_failure` item is
  created per organization, with `source_object_type='system_job'` and a
  day-stable synthetic `source_object_id` so repeated cron runs on the same
  day fold into a single open ticket per org (via the existing partial unique
  index on open workqueue items).

If **both channels fail**, the script exits with code `2`. If either succeeds
but an alert was warranted, the script exits with code `1`. A clean run exits
with `0`. The surrounding cron should surface non-zero exits.

## Required environment / secrets

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase upserts + workqueue insert |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE`) | Supabase upserts + workqueue insert |
| `RESEND_API_KEY` | Email alerts |
| `RESEND_FROM_EMAIL` *(optional)* | Defaults to `alerts@therassistant.app` |
| `BILLING_CODES_REFRESH_ALERT_EMAIL` (or `OPS_ALERT_EMAIL`) | Comma-separated email recipients |
| `ICD10_DOWNLOAD_URL` *(optional)* | Override CMS ICD-10 URL if CMS reshuffles their path |
| `HCPCS_DOWNLOAD_URL` *(optional)* | Override CMS HCPCS URL likewise |

## Triage steps when an alert fires

1. **Open the workqueue item or email.** The `context_payload` /
   email body contain the per-system results, alert reasons, and run
   timestamps.
2. **If an `error` reason:**
   - HTTP 404 on download → CMS likely reshuffled the file path. Find the
     current URL on the CMS pages linked below and re-run the script with
     `ICD10_DOWNLOAD_URL=…` / `HCPCS_DOWNLOAD_URL=…` set.
   - "Missing NEXT_PUBLIC_SUPABASE_URL or service-role key" → the cron
     environment is missing the Supabase secret. Fix the cron job's env.
   - Parse error ("missing required columns") → CMS changed the file format.
     Patch `parseIcd10` / `parseHcpcs` in `scripts/import-billing-codes.ts`
     and re-run.
3. **If a `missing` reason:**
   - Check the CMS landing page (links below) — has the new release actually
     been published yet? If CMS is just late, snooze the workqueue item with
     a comment and the next monthly run will clear it once the release lands.
   - If CMS has published but our script still returns 0 rows, the download
     URL pattern likely changed (it's templated on the current year). Set
     the override env var and re-run.
4. **Re-run on demand:**
   ```bash
   cd artifacts/therassistant-ehr
   tsx scripts/refresh-billing-codes.ts
   ```
   A successful re-run leaves a `0` exit code; the open workqueue ticket can
   then be resolved.

## CMS source pages (for finding new URLs when CMS reshuffles them)

- ICD-10-CM: https://www.cms.gov/medicare/coding-billing/icd-10-codes
- HCPCS Level II: https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update

## Related code

- `scripts/refresh-billing-codes.ts` — scheduled entry point + download glue.
- `scripts/import-billing-codes.ts` — shared parse/upsert logic (also the
  manual import CLI for CPT).
- `lib/billingCodes/refreshAlertLogic.ts` — pure outcome evaluation (tested
  in `scripts/__tests__/refresh-billing-codes-alert.test.ts`).
- `lib/billingCodes/refreshAlert.ts` — Resend + workqueue alert dispatch.
- `supabase/migrations/20260601000000_source_object_type_system_job.sql` —
  adds the `system_job` enum value used by the workqueue alert rows.
