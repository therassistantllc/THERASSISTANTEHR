# Settings Control-Layer Audit

**Scope:** Map every settings/configuration surface in TherAssistant EHR, identify the
canonical source of truth for each, find hardcoded fallbacks and overlapping/duplicated
settings behavior, then remove hardcoding where it is safe to do so.

**Method:** Inspected the **live Supabase schema** (`information_schema` + `system_settings`
contents) — not migration files — and read the actual consuming code. Findings below reflect
what is in the running database and code as of this audit.

---

## 1. Settings UI pages

All settings pages under `app/settings/` are **currently placeholders** (read-only, no
write capability). The index page at `app/settings/page.tsx` lists 16 setting areas:

| # | Setting area | Route | Target table/key | Status |
|---|---|---|---|---|
| 1 | Users & Clinicians | `/settings/users` | `staff` + `staff_roles` | Placeholder |
| 2 | Organizations | `/settings/organizations` | `organizations` | Placeholder |
| 3 | Payers | `/settings/payers` | `payer_plans` | Placeholder |
| 4 | Clearinghouse / Availity | `/settings/clearinghouse` | `clearinghouse_connections` | Placeholder |
| 5 | Service Locations | `/settings/service-locations` | `service_locations` | Placeholder |
| 6 | Billing Defaults | `/settings/billing-defaults` | `system_settings['organization.billing_profile']` | Placeholder |
| 7 | Patient Portal | `/settings/portal` | `system_settings['organization.portal_settings']` | Placeholder |
| 8 | Security | `/settings/security` | `system_settings['security.defaults']` | Placeholder |
| 9 | System Readiness | `/settings/system-readiness` | Readiness checks | Placeholder |
| 10 | Audit Log | `/settings/audit-log` | `custom_audit_event` | Placeholder |
| 11 | Mailroom Settings | `/settings/mailroom` | `system_settings['mailroom.defaults']` | Placeholder |
| 12 | Trading Partner | `/settings/trading-partner` | `system_settings['organization.billing_profile']` | Placeholder |
| 13 | Payer Enrollments | `/settings/payer-enrollments` | `payer_enrollments` | Placeholder |
| 14 | Business Associate Agreements | `/settings/baa` | `baa_agreements` | Placeholder |
| 15 | Code Sets | `/settings/code-sets` | `billing_codes` + `concept_dictionary` | Placeholder |
| 16 | EDI Setup | `/settings/edi` | `clearinghouse_connections` | Placeholder |

---

## 2. Audit matrix

| Setting area | UI page | API route | Table / source | Used by | Hardcoded fallback? | Canonical location | Fix needed |
|---|---|---|---|---|---|---|---|
| **1. Org billing profile** (NPI, EIN, address, auth rep) | `/settings/billing-defaults`, `/settings/trading-partner` | none (seeded) | `system_settings['organization.billing_profile']` | `lib/validation/facts/billingDefaults.ts`, `lib/validation/facts/tradingPartner.ts`, `lib/validation/simulation.tsx`, claim Box 33, `app/api/auth/me/route.ts` | No — empty `{}` fallback, no fabricated values | `system_settings['organization.billing_profile']` | Build placeholder UI to write this key |
| **2. Org profile** (name, timezone, default state) | `/settings/organizations` | `/api/organizations/[orgId]` | `organizations` | claim/EDI headers, readiness | DB defaults: `timezone='America/Denver'`, `default_state='CO'` | `organizations` row | Move `submitter_id` off column default |
| **3. Org submitter ID** | `/settings/organizations` | `/api/organizations/[orgId]` | `organizations.submitter_id` | EDI ISA header, claim readiness | **`'1082546'`** (column default — real Office Ally ID) | `organizations` row | **High** — real submitter ID baked as default; must be per-org |
| **4. Default org ID** | n/a | all routes | `lib/config.ts` | every page/route | `11111111-1111-1111-1111-111111111111` | `env NEXT_PUBLIC_ORGANIZATION_ID` | Acceptable dev fallback |
| **5. Place of service (POS)** | encounter / billing pages | encounter routes | `service_locations` + `lib/billing/placeOfService.ts` | `lib/ehr/pipeline.ts`, `lib/claims/edi837pBatchService.ts`, claim readiness | **Fixed** — was `"11"` literals (×4) + invalid `"10"` (×3) | `lib/billing/placeOfService.ts` | **FIXED** |
| **6. Clearinghouse / EDI** | `/settings/clearinghouse`, `/settings/edi` | `/api/integrations/availity/token-test` | `clearinghouse_connections` | `lib/claims/edi837pBatchService.ts`, `lib/clearinghouse/*`, eligibility | `receiver_id ?? "330897513"`, `isa_usage_indicator ?? "T"`, `*OA*`, `005010X222A1` | `clearinghouse_connections` row | **Needs EDI round-trip test** |
| **7. Payer timely filing** | `/settings/payers` | none | `payer_plans.timely_filing_days` | timely-filing checks, enrollment gate | `365` (DB default) | `payer_plans` row | OK |
| **8. Patient portal** | `/settings/portal` | portal routes | `system_settings['organization.portal_settings']` | `app/portal/*`, `lib/portal/portalSettings.ts` | `DEFAULT_PORTAL_SETTINGS` (code defaults) | `system_settings['organization.portal_settings']` | **Overlap**: 3 key namespaces |
| **9. Staff notifications** | n/a | `/api/billing/notification-preferences` | `staff_notification_preferences` | eligibility routing alerts | `true` (DB defaults) | `staff_notification_preferences` | OK |
| **10. Billing defaults bucket** | `/settings/billing-defaults` | none | `system_settings['billing.defaults']` | billing workflows | code defaults | `system_settings` | OK |
| **11. Claims defaults bucket** | `/settings/edi` | none | `system_settings['claims.defaults']` | claim generation | code defaults | `system_settings` | OK |
| **12. Eligibility defaults bucket** | `/settings/edi` | none | `system_settings['eligibility.defaults']` | eligibility checks | code defaults | `system_settings` | OK |
| **13. Mailroom defaults bucket** | `/settings/mailroom` | none | `system_settings['mailroom.defaults']` | mailroom processing | code defaults | `system_settings` | OK |
| **14. Security defaults bucket** | `/settings/security` | none | `system_settings['security.defaults']` | security controls | code defaults | `system_settings` | OK |
| **15. Telehealth defaults bucket** | `/settings/edi` | none | `system_settings['telehealth.defaults']` | telehealth sessions | code defaults | `system_settings` | OK |
| **16. Chat defaults bucket** | `/settings/edi` | none | `system_settings['chat.defaults']` | chat features | code defaults | `system_settings` | OK |
| **17. VCC defaults bucket** | `/settings/edi` | none | `system_settings['vcc.defaults']` | VCC processing | code defaults | `system_settings` | OK |
| **18. Clearinghouse defaults bucket** | `/settings/clearinghouse` | none | `system_settings['clearinghouse.defaults']` | clearinghouse config | code defaults | `system_settings` | OK |
| **19. Medicaid telehealth checkin** | `/settings/edi` | none | `system_settings['medicaid_telehealth_checkin.defaults']` | medicaid workflows | code defaults | `system_settings` | OK |
| **20. 277CA auto-route** | `/settings/billing-defaults` | none | `system_settings['billing.rejections_277ca_autoroute']` | `lib/billing/rejections277ca.ts` | `REJECTION_277CA_AUTOROUTE_DEFAULTS` | `system_settings` | OK |
| **21. Payer status auto-check** | `/settings/payers` | cron jobs | `system_settings['payer_status.auto_check_last_run']` | cron claim status checks | none | `system_settings` | OK |
| **22. Underpayment threshold** | `/settings/billing-defaults` | none | `system_settings['payment_posting.underpayment_threshold_pct']` | `lib/payments/postingEngine/workqueueRules.ts` | `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` | `system_settings` | **Hardcoded** — should be configurable |
| **23. No-response days** | `/settings/billing-defaults` | none | `system_settings['payment_posting.no_response_days']` | `lib/payments/postingEngine/workqueueRules.ts` | `DEFAULT_NO_RESPONSE_DAYS = 30` | `system_settings` | **Hardcoded** — should be configurable |
| **24. Eligibility service type** | `/settings/edi` | eligibility routes | `system_settings['eligibility_service_type_code']` | eligibility requests | `98` (default) | `system_settings` | OK |
| **25. Security supervision rules** | `/settings/security` | claim generation | `system_settings['security.supervision.rules']` | `837p` generation | none | `system_settings` | OK |
| **26. Service locations** | `/settings/service-locations` | none | `service_locations` | encounter booking, POS | `11` (DB default) | `service_locations` | OK |
| **27. Provider credentialing** | `/settings/users` | claim generation | `providers` + `credentialing_profiles` | claim rendering provider | code defaults | `providers` | Needs audit |
| **28. Custom app config** | none | none | `custom_app_config` | No TypeScript references found | n/a | n/a | **Orphaned** — table exists in schema but no app code references it |
| **29. Integration connections** | `/settings/edi` | `/api/integrations/connections` | `integration_connections` | Telehealth, fax, email, Availity | `clearinghouse_connections` | `integration_connections` | Active; used by telehealth/oauth |
| **30. Payer configurations** | `/settings/payers` | eligibility routes | `payer_configurations` | Eligibility preparation | DB defaults | `payer_configurations` | Active; used for payer-specific configs |
| **31. Orphaned tables** | none | none | `custom_billing_settings`, `custom_note_settings` | nothing | n/a | n/a | **Not present** in schema or any migration file |

---

## 3. Hardcoded operational values

| Value | File | Line | Description | Risk |
|---|---|---|---|---|
| `1082546` | `schema.sql` | column default on `organizations.submitter_id` | Real Office Ally submitter ID as default | **High** — real org identifier in schema |
| `330897513` | `lib/claims/edi837pBatchService.ts` | 185 | Default receiver ID in ISA header | **High** — EDI routing identifier |
| `030240928` | `lib/claims/rebuild837pForRejection.ts` | 185 | Default receiver ID | **High** — EDI routing identifier |
| `T` | `lib/claims/edi837pBatchService.ts` | 185 | ISA usage indicator (test mode) | **Medium** — affects production claim routing |
| `005010X222A1` | `lib/claims/edi837pBatchService.ts` | 185 | X12 version literal | **Medium** — claim format version |
| `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` | `lib/payments/postingEngine/workqueueRules.ts` | 35 | 80% underpayment threshold | **Medium** — business logic |
| `DEFAULT_NO_RESPONSE_DAYS = 30` | `lib/payments/postingEngine/workqueueRules.ts` | 583 | 30-day no-response flag | **Medium** — business logic |
| `DEFAULT_TIMELY_FILING_DAYS = 90` | `lib/billing/timelyFiling.ts` | 9 | 90-day timely filing deadline | **Medium** — compliance |
| `DEFAULT_APPEAL_DEADLINE_DAYS = 180` | `lib/billing/timelyFiling.ts` | 10 | 180-day appeal deadline | **Medium** — compliance |
| `DEFAULT_CORRECTED_CLAIM_DAYS = 180` | `lib/billing/timelyFiling.ts` | 11 | 180-day corrected claim deadline | **Medium** — compliance |
| `HIGH_DOLLAR_THRESHOLD = 1000` | `app/billing/ready-to-generate/ReadyToGenerateClient.tsx` | 71 | $1000 high-dollar claim flag | **Medium** — business logic |
| `STALE_DAYS = 30` | `app/patients/.../EligibilityDetailClient.tsx` | 117 | 30-day stale eligibility check | **Medium** — business logic |
| `SUGGEST_THRESHOLD = 250` | `lib/billing/suggestOffsetPayment.ts` | 54 | $250 suggest offset threshold | **Medium** — business logic |
| `PRESELECT_THRESHOLD = 500` | `lib/billing/suggestOffsetPayment.ts` | 56 | $500 preselect offset threshold | **Medium** — business logic |
| `CARD_SUGGESTION_MIN_CONFIDENCE = 0.55` | `lib/insurance/parseCardImage.ts` | 244 | 55% OCR confidence threshold | **Medium** — AI threshold |
| `DEFAULT_REALTIME_DEADLINE_MS = 20_000` | `lib/clearinghouse/eligibilityErrors.ts` | 45 | 20s eligibility timeout | **Medium** — operational |
| `AVAILITY_RECEIVER_ID = "030240928"` | `lib/clearinghouse/buildEligibility270InputFromContext.ts` | 84 | Availity receiver ID | **High** — EDI routing |
| `0000000000` / `000000000` | `lib/claims/chargeCaptureClaimBridgeService.tsx` | 81 | Dummy NPI/TaxID placeholder | **Low** — placeholder in dev |
| `STRIPE_MIN_CENTS = 50` | `lib/portal/invoiceCheckout.ts` | 43 | $0.50 minimum Stripe charge | **Low** — payment gateway |
| `0.85` | `app/billing/unmatched-era/UnmatchedEraClient.tsx` | 354 | 85% ERA match confidence | **Medium** — matching logic |
| `FAR_FUTURE_ISO = "9999-12-31"` | `lib/workqueue/...ClaimRejectionWorkqueueService.tsx` | 10 | Database sentinel value | **Low** — technical sentinel |
| `UNIQUE_VIOLATION = "23505"` | `lib/encounters/findOrCreate.ts` | 16 | Postgres error code | **Low** — technical constant |
| `365` | `payer_plans.timely_filing_days` | column default | Timely filing days | **Medium** — compliance default |
| `America/Denver` | `organizations.timezone` | column default | Default timezone | **Low** — acceptable default |
| `CO` | `organizations.default_state` | column default | Default state | **Low** — acceptable default |
| `11` | `service_locations.place_of_service_code` | column default | Default POS code | **Low** — acceptable default |
| `98` | `eligibility_service_type_code` | system_settings default | Eligibility service type | **Low** — X12 standard |
| `gpt-4o-mini-transcribe` | `lib/portal/transcribeAudio.ts` | 15 | AI model for transcription | **Low** — model selection |
| `[24, 72, 168]` hours | `lib/payments/autopayService.ts` | 930 | Autopay retry backoff | **Medium** — payment retry logic |
| `4 * 1024 * 1024` | `lib/claims/rebuild837PBatchFile.ts` | 654 | 4MB batch file limit | **Low** — file upload limit |
| `PAGE_SIZE` (10, 50, 200) | various UI files | 329 | Table pagination sizes | **Low** — UI defaults |
| `STRIPE_JS_URL` | `app/calendar/MonthCalendarClient.tsx` | 816 | Stripe JS URL | **Low** — integration URL |
| `STRIPE_API_BASE` | `lib/stripe/connect.ts` | 11 | Stripe API base URL | **Low** — integration URL |
| `AVAILITY_CORE_SOAP_ENDPOINT` | `lib/edi/availity270/soapEnvelope.ts` | 24 | Availity SOAP endpoint | **Low** — integration URL |
| `ZOOM_API` | `lib/telehealth/adapters/zoom.ts` | 12 | Zoom API base URL | **Low** — integration URL |
| `CAL_API` | `lib/telehealth/adapters/googleMeet.ts` | 12 | Google Calendar API URL | **Low** — integration URL |

---

## 4. Environment variables

| Variable | Used by | Purpose | Fallback |
|---|---|---|---|
| `NEXT_PUBLIC_ORGANIZATION_ID` | `lib/config.ts` | Default org for single-tenant | `11111111-1111-1111-1111-111111111111` |
| `DATABASE_URL` | Supabase client | Database connection | none |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client | Supabase project URL | none |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | Supabase anon key | none |
| `SUPABASE_SERVICE_ROLE_KEY` | Server operations | Privileged DB access | none |
| `AVAILITY_CLIENT_ID` | `lib/availity/env.tsx` | Availity OAuth client | none |
| `AVAILITY_CLIENT_SECRET` | `lib/availity/env.tsx` | Availity OAuth secret | none |
| `AVAILITY_EDI_API_KEY` | `lib/availity/env.tsx` | Availity EDI API key | none |
| `AVAILITY_EDI_BASE_URL` | `lib/availity/env.tsx` | Availity EDI base URL | none |
| `AVAILITY_OAUTH_TOKEN_URL` | `lib/availity/env.tsx` | Availity token endpoint | none |
| `TELNYX_API_KEY` | `lib/fax/provider.ts` | Fax API key | none |
| `TELNYX_FROM_NUMBER` | `lib/fax/provider.ts` | Fax sender number | none |
| `TELNYX_CONNECTION_ID` | `lib/fax/provider.ts` | Fax connection ID | none |
| `RESEND_API_KEY` | `lib/resend/client.ts` | Email API key | none |
| `RESEND_FROM_EMAIL` | `lib/resend/client.ts` | Sender email | none |
| `STRIPE_SECRET_KEY` | `lib/stripe/connect.ts` | Stripe API key | none |
| `STRIPE_WEBHOOK_SECRET` | `lib/stripe/connect.ts` | Stripe webhook secret | none |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `lib/stripe/connect.ts` | Stripe Connect webhook secret | none |
| `ZOOM_CLIENT_ID` | `lib/telehealth/adapters/zoom.ts` | Zoom OAuth client | none |
| `ZOOM_CLIENT_SECRET` | `lib/telehealth/adapters/zoom.ts` | Zoom OAuth secret | none |
| `GOOGLE_CLIENT_ID` | `lib/telehealth/adapters/googleMeet.ts` | Google OAuth client | none |
| `GOOGLE_CLIENT_SECRET` | `lib/telehealth/adapters/googleMeet.ts` | Google OAuth secret | none |
| `TELEHEALTH_TOKEN_ENC_KEY` | `lib/telehealth/*` | Token encryption key | none |
| `ALLOW_DEV_AUTH_BYPASS` | `lib/auth.ts` | Dev auth bypass | `false` |
| `NEXT_PUBLIC_APP_URL` | Various | App base URL | none |
| `APP_URL` | Various | App base URL | none |
| `PORT` | Dev server | Server port | `8080` |
| `NODE_ENV` | Various | Environment | `development` |

---

## 5. Key findings

### 5a. Overlapping settings stores

The app has **one canonical settings store** — `system_settings` (org-scoped JSONB key/value,
25+ live keys). Two **legacy structured tables** (`custom_billing_settings`,
`custom_note_settings`) were referenced in a prior audit document but are **not present**
in the current schema.sql or any migration file — they may have existed in a pre-v0
schema and were already removed before this codebase snapshot.

There is also **portal-setting fragmentation** inside `system_settings` itself: discrete booleans
(`patient_portal.enabled`, `patient_portal.allow_*`), an object (`portal.defaults`), and another
object (`organization.portal_settings`) all describe portal behavior. The portal pages
(`app/portal/home/page.tsx`, `app/portal/[token]/page.tsx`) **already query** `system_settings`
for `organization.portal_settings`, so they are wired correctly.

### 5b. Place-of-service hardcoding (with a latent bug)

The canonical POS module `lib/billing/placeOfService.ts` allows **only `11` (office)** and
**`02` (telehealth)**, and `placeOfServiceWarning` **explicitly rejects `10`**. Despite this,
claim-building code fell back to inline literals:

- `"11"` in `lib/ehr/pipeline.ts` (×4) — duplicated magic constant.
- **`"10"`** in `lib/claims/edi837pBatchService.ts` (×2) and `BillingDetailsClient.tsx` (×1) —
  a missing POS would produce an 837P/UI value that the app's **own validation gate rejects**.

**Status:** Fixed in prior work (consolidated onto `DEFAULT_OFFICE_PLACE_OF_SERVICE`).

### 5c. All 16 settings UIs are placeholders

None of the settings pages under `app/settings/` have read/write capability. They are
architectural shells that display static content. This is the single largest gap in the
settings layer — values must be seeded directly into the database.

### 5d. EDI header hardcoding (high risk)

The `clearinghouse_connections` table has columns for `gs_receiver_code`, `receiver_id`,
`isa_usage_indicator`, `claims_x12_version`, but claim generation code uses inline literals:

- `receiver_id ?? "330897513"` in `lib/claims/edi837pBatchService.ts`
- `isa_usage_indicator ?? "T"` in `lib/claims/edi837pBatchService.ts`
- `*OA*` (gs_receiver_code) literal in `lib/claims/edi837pBatchService.ts`
- `005010X222A1` (x12 version) literal in `lib/claims/edi837pBatchService.ts`

These are **production claim identifiers** — changing them without testing will break
EDI submissions. The `clearinghouse_connections` table exists but is not queried for these
values during claim generation.

### 5e. Business logic thresholds are hardcoded

Multiple thresholds that should be org-configurable are hardcoded:

- `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` (80%)
- `DEFAULT_NO_RESPONSE_DAYS = 30`
- `HIGH_DOLLAR_THRESHOLD = 1000`
- `STALE_DAYS = 30`
- `SUGGEST_THRESHOLD = 250` / `PRESELECT_THRESHOLD = 500`
- `DEFAULT_TIMELY_FILING_DAYS = 90` / `DEFAULT_APPEAL_DEADLINE_DAYS = 180`
- `CARD_SUGGESTION_MIN_CONFIDENCE = 0.55`
- `DEFAULT_REALTIME_DEADLINE_MS = 20_000`

These are scattered across `lib/`, `app/`, and components. The `system_settings` keys
`payment_posting.underpayment_threshold_pct` and `payment_posting.no_response_days` exist
but the code does **not** query them — it uses hardcoded constants.

### 5f. Schema-level defaults with real values

Two columns in the schema have real-world identifiers as defaults:

- `organizations.submitter_id = '1082546'` (Office Ally submitter ID)
- `organizations.default_state = 'CO'` (Colorado)
- `organizations.timezone = 'America/Denver'` (Mountain Time)

`default_state` and `timezone` are acceptable defaults, but `submitter_id` is a real
identifier that should be per-organization.

---

## 6. Changes made (remove hardcoding)

Consolidated all real POS fallbacks onto the canonical module and fixed the invalid `"10"` default:

- `lib/billing/placeOfService.ts` — added `DEFAULT_OFFICE_PLACE_OF_SERVICE` (`"11"`) and
  `DEFAULT_TELEHEALTH_PLACE_OF_SERVICE` (`"02"`); `defaultPlaceOfService()` now uses them.
- `lib/ehr/pipeline.ts` — replaced 4 `"11"` literals with `DEFAULT_OFFICE_PLACE_OF_SERVICE`.
- `lib/claims/edi837pBatchService.ts` — replaced 2 invalid `?? "10"` fallbacks with
  `DEFAULT_OFFICE_PLACE_OF_SERVICE` (bug fix: claims no longer fall back to a disallowed POS).
- `app/encounters/[encounterId]/billing/BillingDetailsClient.tsx` — replaced both the loaded-row
  fallback (`|| "10"`) and the `blankServiceLine()` default (`"10"`) with
  `DEFAULT_OFFICE_PLACE_OF_SERVICE`.
- `lib/canonical-ehr/model.tsx` — replaced the invalid telehealth POS `"10"` with
  `DEFAULT_TELEHEALTH_PLACE_OF_SERVICE` (`"02"`), the allowed telehealth code for the encounter's
  explicit telehealth context.
- `lib/workflow/workflowFunctions.tsx` — replaced 2 `"11"` literals with
  `DEFAULT_OFFICE_PLACE_OF_SERVICE`.

---

## 7. Remaining follow-ups (prioritized)

### 7a. Critical (breaks production claims)

1. **De-hardcode EDI ISA/GS header** in `lib/claims/edi837pBatchService.ts` — read
   `gs_receiver_code`, `claims_x12_version`, `receiver_qualifier`, and `receiver_id` from the
   `clearinghouse_connections` row instead of literals. **Deferred** because it changes generated
   X12 and needs a clearinghouse round-trip test.
2. **Move `organizations.submitter_id` default off the schema** — `'1082546'` is a real submitter
   ID baked as a column default; it should be set per organization, not defaulted.

### 7b. High (business logic should be configurable)

3. **Wire underpayment threshold to `system_settings`** — read `payment_posting.underpayment_threshold_pct`
   from `system_settings` instead of hardcoded `0.8`.
4. **Wire no-response days to `system_settings`** — read `payment_posting.no_response_days` from
   `system_settings` instead of hardcoded `30`.
5. **Wire timely filing thresholds to `system_settings`** — read `DEFAULT_TIMELY_FILING_DAYS`,
   `DEFAULT_APPEAL_DEADLINE_DAYS`, `DEFAULT_CORRECTED_CLAIM_DAYS` from `system_settings`.
6. **Wire high-dollar threshold to `system_settings`** — read `HIGH_DOLLAR_THRESHOLD` from
   `system_settings` instead of hardcoded `1000`.

### 7c. Medium (integration/config)

7. **Move integration URLs to environment** — `AVAILITY_CORE_SOAP_ENDPOINT`, `ZOOM_API`,
   `STRIPE_API_BASE` should be env-configurable for sandbox/production switching.
8. **Move AI model selection to environment** — `gpt-4o-mini-transcribe` should be configurable.
9. **Consolidate portal settings** into a single `organization.portal_settings` object and migrate
   the discrete `patient_portal.*` / `portal.defaults` keys.

### 7d. Low (cosmetic)

10. **Implement the 16 placeholder settings UIs** so values are editable in-app rather than
    seeded directly into the database.
11. **Consolidate page size constants** (10, 50, 200) into a shared `lib/constants.ts`.
12. **Move `UNIQUE_VIOLATION` error code** to a shared database utility.

---

## 8. Summary

- **Settings store:** `system_settings` (canonical) + `clearinghouse_connections` + `organizations` + `staff_notification_preferences` + `service_locations`
- **Settings UI:** 16 placeholder pages, zero write capability
- **system_settings keys:** 25+ active keys
- **Hardcoded values:** ~35 identified (POS — fixed, EDI — critical, business thresholds — high)
- **Environment variables:** 25+ (integration credentials, auth, base URLs)
- **Overlap risk:** Portal settings (3 key namespaces), EDI headers (table has columns but code uses literals)
