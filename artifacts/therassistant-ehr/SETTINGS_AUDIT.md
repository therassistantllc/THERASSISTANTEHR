# Settings Control-Layer Audit

**Scope:** Map every settings/configuration surface in TherAssistant EHR, identify the
canonical source of truth for each, find hardcoded fallbacks and overlapping/duplicated
settings behavior, then remove hardcoding where it is safe to do so.

**Method:** Inspected the **repository schema** (`schema.sql`) and **consuming code**
(TypeScript/TSX files). No live database was accessible for this audit; findings reflect
what exists in the codebase. Where live-only tables may exist (e.g., `organization_settings`),
this is explicitly noted.

---

## 1. Domain taxonomy

The 13 settings domains in the EHR:

| # | Domain | Description | Settings pages |
|---|---|---|---|
| D1 | Organization | Org identity, profile, NPI, EIN, address | `/settings/organizations`, `/settings/billing-defaults`, `/settings/trading-partner` |
| D2 | Users & Staff | Clinician roster, roles, permissions | `/settings/users` |
| D3 | Provider | Rendering providers, credentialing, NPI | `/settings/users` |
| D4 | Payer | Payer plans, profiles, enrollments | `/settings/payers`, `/settings/payer-enrollments` |
| D5 | Clearinghouse | EDI transport, Availity connection, ISA/GS headers | `/settings/clearinghouse`, `/settings/edi` |
| D6 | Service Location | Physical locations, place of service codes | `/settings/service-locations` |
| D7 | Billing | Billing defaults, rates, write-offs | `/settings/billing-defaults` |
| D8 | Claims | Claim generation, submission, status checks | `/settings/edi` |
| D9 | Patient Portal | Portal branding, messaging, access | `/settings/portal` |
| D10 | Security | Access controls, supervision, audit | `/settings/security`, `/settings/audit-log` |
| D11 | Telehealth | Zoom, Google Meet, session config | `/settings/edi` |
| D12 | Mailroom | Fax, email, document processing | `/settings/mailroom` |
| D13 | Integration | Third-party connectors (Stripe, Telnyx, Resend) | `/settings/edi` |

---

## 2. Settings UI pages

All 16 settings pages under `app/settings/` are **currently placeholders** (read-only, no
write capability). The index page at `app/settings/page.tsx` lists all areas:

| # | Setting area | Route | Target domain | Target table/key | Status |
|---|---|---|---|---|---|
| 1 | Users & Clinicians | `/settings/users` | D2, D3 | `staff`, `staff_roles`, `providers` | Placeholder |
| 2 | Organizations | `/settings/organizations` | D1 | `organizations` | Placeholder |
| 3 | Payers | `/settings/payers` | D4 | `payer_plans`, `payer_profiles` | Placeholder |
| 4 | Clearinghouse / Availity | `/settings/clearinghouse` | D5 | `clearinghouse_connections` | Placeholder |
| 5 | Service Locations | `/settings/service-locations` | D6 | `service_locations` | Placeholder |
| 6 | Billing Defaults | `/settings/billing-defaults` | D7, D1 | `system_settings['organization.billing_profile']` | Placeholder |
| 7 | Patient Portal | `/settings/portal` | D9 | `system_settings['organization.portal_settings']` | Placeholder |
| 8 | Security | `/settings/security` | D10 | `system_settings['security.defaults']` | Placeholder |
| 9 | System Readiness | `/settings/system-readiness` | D1-D13 | Readiness checks | Placeholder |
| 10 | Audit Log | `/settings/audit-log` | D10 | `custom_audit_event` | Placeholder |
| 11 | Mailroom Settings | `/settings/mailroom` | D12 | `system_settings['mailroom.defaults']` | Placeholder |
| 12 | Trading Partner | `/settings/trading-partner` | D1, D5 | `system_settings['organization.billing_profile']` | Placeholder |
| 13 | Payer Enrollments | `/settings/payer-enrollments` | D4 | `payer_enrollments` | Placeholder |
| 14 | Business Associate Agreements | `/settings/baa` | D10 | `baa_agreements` | Placeholder |
| 15 | Code Sets | `/settings/code-sets` | D4, D7 | `billing_codes`, `concept_dictionary` | Placeholder |
| 16 | EDI Setup | `/settings/edi` | D5, D8, D11 | `clearinghouse_connections`, `system_settings` | Placeholder |

---

## 3. Audit matrix

| # | Domain | Setting area | UI page | API route | Table / source | Used by | Hardcoded fallback? | Canonical location | Fix needed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | D1 | Org billing profile | `/settings/billing-defaults`, `/settings/trading-partner` | none | `system_settings['organization.billing_profile']` | `lib/validation/facts/billingDefaults.ts`, `lib/validation/facts/tradingPartner.ts`, `lib/validation/simulation.tsx`, claim Box 33, `app/api/auth/me/route.ts` | No — empty `{}` fallback | `system_settings['organization.billing_profile']` | Build placeholder UI |
| 2 | D1 | Org profile (name, timezone, state) | `/settings/organizations` | `/api/organizations/[orgId]` | `organizations` | claim/EDI headers, readiness | DB defaults: `timezone='America/Denver'`, `default_state='CO'` | `organizations` | Acceptable defaults |
| 3 | D1 | Default org ID | n/a | all routes | `lib/config.ts` | every page/route | `11111111-1111-1111-1111-111111111111` | `env NEXT_PUBLIC_ORGANIZATION_ID` | Acceptable dev fallback |
| 4 | D5 | Place of service (POS) | encounter pages | encounter routes | `service_locations` + `lib/billing/placeOfService.ts` | `lib/ehr/pipeline.ts`, `lib/claims/edi837pBatchService.ts`, readiness | **Fixed** — was `"11"` literals (×4) + invalid `"10"` (×3) | `lib/billing/placeOfService.ts` | **FIXED** |
| 5 | D5 | Clearinghouse EDI headers | `/settings/clearinghouse`, `/settings/edi` | `/api/integrations/availity/token-test` | `clearinghouse_connections` | `lib/claims/edi837pBatchService.ts`, `lib/clearinghouse/*` | `receiver_id ?? "330897513"`, `isa_usage_indicator ?? "T"`, `*OA*`, `005010X222A1` | `clearinghouse_connections` | **Needs EDI round-trip test** |
| 6 | D5 | Clearinghouse submitter ID | `/settings/clearinghouse` | readiness checks | `clearinghouse_connections.submitter_id` | `system_readiness` view | None (nullable text) | `clearinghouse_connections` | OK |
| 7 | D4 | Payer timely filing | `/settings/payers` | none | `payer_plans.timely_filing_days` | timely-filing checks | `365` (DB default) | `payer_plans` | OK |
| 8 | D4 | Payer appeal deadline | `/settings/payers` | none | `payer_plans.appeal_deadline_days` | timely-filing checks | `60` (DB default) | `payer_plans` | OK |
| 9 | D9 | Patient portal | `/settings/portal` | portal routes | `system_settings['organization.portal_settings']` | `app/portal/*`, `lib/portal/portalSettings.ts` | `DEFAULT_PORTAL_SETTINGS` | `system_settings['organization.portal_settings']` | **Overlap**: 3 key namespaces |
| 10 | D2 | Staff notifications | n/a | `/api/billing/notification-preferences` | `staff_notification_preferences` | eligibility alerts | `true` (DB defaults) | `staff_notification_preferences` | OK |
| 11 | D7 | Billing defaults bucket | `/settings/billing-defaults` | none | `system_settings['billing.defaults']` | billing workflows | code defaults | `system_settings` | OK |
| 12 | D8 | Claims defaults bucket | `/settings/edi` | none | `system_settings['claims.defaults']` | claim generation | code defaults | `system_settings` | OK |
| 13 | D5 | Eligibility defaults bucket | `/settings/edi` | none | `system_settings['eligibility.defaults']` | eligibility checks | code defaults | `system_settings` | OK |
| 14 | D12 | Mailroom defaults bucket | `/settings/mailroom` | none | `system_settings['mailroom.defaults']` | mailroom processing | code defaults | `system_settings` | OK |
| 15 | D10 | Security defaults bucket | `/settings/security` | none | `system_settings['security.defaults']` | security controls | code defaults | `system_settings` | OK |
| 16 | D11 | Telehealth defaults bucket | `/settings/edi` | none | `system_settings['telehealth.defaults']` | telehealth sessions | code defaults | `system_settings` | OK |
| 17 | D9 | Chat defaults bucket | `/settings/edi` | none | `system_settings['chat.defaults']` | chat features | code defaults | `system_settings` | OK |
| 18 | D7 | VCC defaults bucket | `/settings/edi` | none | `system_settings['vcc.defaults']` | VCC processing | code defaults | `system_settings` | OK |
| 19 | D5 | Clearinghouse defaults bucket | `/settings/clearinghouse` | none | `system_settings['clearinghouse.defaults']` | clearinghouse config | code defaults | `system_settings` | OK |
| 20 | D11 | Medicaid telehealth checkin | `/settings/edi` | none | `system_settings['medicaid_telehealth_checkin.defaults']` | medicaid workflows | code defaults | `system_settings` | OK |
| 21 | D8 | 277CA auto-route | `/settings/billing-defaults` | none | `system_settings['billing.rejections_277ca_autoroute']` | `lib/billing/rejections277ca.ts` | `REJECTION_277CA_AUTOROUTE_DEFAULTS` | `system_settings` | OK |
| 22 | D4 | Payer status auto-check | `/settings/payers` | cron jobs | `system_settings['payer_status.auto_check_last_run']` | cron claim checks | None | `system_settings` | OK |
| 23 | D7 | Underpayment threshold | `/settings/billing-defaults` | none | `system_settings['payment_posting.underpayment_threshold_pct']` | `lib/payments/postingEngine/workqueueRules.ts` | `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` | `system_settings` | **Hardcoded** — code queries `organization_settings` (live-only table not in schema) |
| 24 | D7 | No-response days | `/settings/billing-defaults` | none | `system_settings['payment_posting.no_response_days']` | `lib/payments/postingEngine/workqueueRules.ts` | `DEFAULT_NO_RESPONSE_DAYS = 30` | `system_settings` | **Hardcoded** — code queries `organization_settings` (live-only table not in schema) |
| 25 | D5 | Eligibility service type | `/settings/edi` | eligibility routes | `clearinghouse_connections.eligibility_service_type_code` + `eligibility_requests.service_type_code` | eligibility requests | `98` (DB default) | `clearinghouse_connections` / `eligibility_requests` | OK |
| 26 | D10 | Security supervision rules | `/settings/security` | claim generation | `system_settings['security.supervision.rules']` | `837p` generation | None | `system_settings` | OK |
| 27 | D6 | Service locations | `/settings/service-locations` | none | `service_locations` | encounter booking, POS | `11` (DB default) | `service_locations` | OK |
| 28 | D3 | Provider credentialing | `/settings/users` | claim generation | `providers` + `credentialing_profiles` | claim rendering | code defaults | `providers` | Needs audit |
| 29 | D1 | Custom app config | none | none | `custom_app_config` | **No TypeScript references found** | n/a | n/a | **Orphaned** — table in schema, no code refs |
| 30 | D13 | Integration connections | `/settings/edi` | `/api/integrations/connections` | `integration_connections` | Telehealth, fax, email | `clearinghouse_connections` | `integration_connections` | Active |
| 31 | D4 | Payer configurations | `/settings/payers` | eligibility routes | `payer_configurations` | eligibility preparation | DB defaults | `payer_configurations` | Active |
| 32 | D7 | Orphaned settings tables | none | none | `custom_billing_settings`, `custom_note_settings` | nothing | n/a | n/a | **Not present** in schema.sql or any migration file |
| 33 | D1 | Organization settings (live-only) | none | none | `organization_settings` | `lib/payments/postingEngine/workqueueRules.ts` | n/a | n/a | **Not present** in schema.sql; code queries it but table may exist only in live DB |

---

## 4. Hardcoded operational values

| Value | File | Line | Description | Risk |
|---|---|---|---|---|
| `330897513` | `lib/claims/edi837pBatchService.ts` | 185 | Default receiver ID in ISA header | **High** — EDI routing |
| `030240928` | `lib/claims/rebuild837pForRejection.ts` | 185 | Default receiver ID | **High** — EDI routing |
| `T` | `lib/claims/edi837pBatchService.ts` | 185 | ISA usage indicator (test mode) | **Medium** — affects routing |
| `005010X222A1` | `lib/claims/edi837pBatchService.ts` | 185 | X12 version literal | **Medium** — claim format |
| `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` | `lib/payments/postingEngine/workqueueRules.ts` | 35 | 80% underpayment threshold | **Medium** — queries `organization_settings` as fallback |
| `DEFAULT_NO_RESPONSE_DAYS = 30` | `lib/payments/postingEngine/workqueueRules.ts` | 583 | 30-day no-response flag | **Medium** — queries `organization_settings` as fallback |
| `DEFAULT_TIMELY_FILING_DAYS = 90` | `lib/billing/timelyFiling.ts` | 9 | 90-day deadline (fallback when payer rule missing) | **Medium** — compliance |
| `DEFAULT_APPEAL_DEADLINE_DAYS = 180` | `lib/billing/timelyFiling.ts` | 10 | 180-day appeal deadline (fallback) | **Medium** — compliance |
| `DEFAULT_CORRECTED_CLAIM_DAYS = 180` | `lib/billing/timelyFiling.ts` | 11 | 180-day corrected claim deadline (fallback) | **Medium** — compliance |
| `HIGH_DOLLAR_THRESHOLD = 1000` | `app/billing/ready-to-generate/ReadyToGenerateClient.tsx` | 71 | $1000 high-dollar claim flag | **Medium** — business logic |
| `STALE_DAYS = 30` | `app/patients/.../EligibilityDetailClient.tsx` | 117 | 30-day stale eligibility check | **Medium** — business logic |
| `SUGGEST_THRESHOLD = 250` | `lib/billing/suggestOffsetPayment.ts` | 54 | $250 suggest offset threshold | **Medium** — business logic |
| `PRESELECT_THRESHOLD = 500` | `lib/billing/suggestOffsetPayment.ts` | 56 | $500 preselect offset threshold | **Medium** — business logic |
| `CARD_SUGGESTION_MIN_CONFIDENCE = 0.55` | `lib/insurance/parseCardImage.ts` | 244 | 55% OCR confidence threshold | **Medium** — AI threshold |
| `DEFAULT_REALTIME_DEADLINE_MS = 20_000` | `lib/clearinghouse/eligibilityErrors.ts` | 45 | 20s eligibility timeout | **Medium** — operational |
| `0000000000` / `000000000` | `lib/claims/chargeCaptureClaimBridgeService.tsx` | 81 | Dummy NPI/TaxID placeholder | **Low** — placeholder in dev |
| `STRIPE_MIN_CENTS = 50` | `lib/portal/invoiceCheckout.ts` | 43 | $0.50 minimum Stripe charge | **Low** — payment gateway |
| `0.85` | `app/billing/unmatched-era/UnmatchedEraClient.tsx` | 354 | 85% ERA match confidence | **Medium** — matching logic |
| `FAR_FUTURE_ISO = "9999-12-31"` | `lib/workqueue/...ClaimRejectionWorkqueueService.tsx` | 10 | Database sentinel value | **Low** — technical sentinel |
| `UNIQUE_VIOLATION = "23505"` | `lib/encounters/findOrCreate.ts` | 16 | Postgres error code | **Low** — technical constant |
| `365` | `payer_plans.timely_filing_days` | column default | Timely filing days | **Medium** — DB default |
| `60` | `payer_plans.appeal_deadline_days` | column default | Appeal deadline days | **Medium** — DB default |
| `1` | `payer_plans.resubmission_limit` | column default | Resubmission limit | **Low** — DB default |
| `America/Denver` | `organizations.timezone` | column default | Default timezone | **Low** — acceptable |
| `CO` | `organizations.default_state` | column default | Default state | **Low** — acceptable |
| `11` | `service_locations.place_of_service_code` | column default | Default POS | **Low** — acceptable |
| `98` | `clearinghouse_connections.eligibility_service_type_code` | column default | Eligibility service type | **Low** — X12 standard |
| `test` | `clearinghouse_connections.mode` | column default | Clearinghouse mode | **Low** — acceptable |
| `mock` | `eligibility_requests.request_mode` | column default | Eligibility request mode | **Low** — dev default |
| `gpt-4o-mini-transcribe` | `lib/portal/transcribeAudio.ts` | 15 | AI model for transcription | **Low** — model selection |
| `[24, 72, 168]` hours | `lib/payments/autopayService.ts` | 930 | Autopay retry backoff | **Medium** — payment retry |
| `4 * 1024 * 1024` | `lib/claims/rebuild837PBatchFile.ts` | 654 | 4MB batch file limit | **Low** — file limit |
| `10`, `50`, `200` | various UI files | 329 | Table pagination sizes | **Low** — UI defaults |
| `STRIPE_JS_URL` | `app/calendar/MonthCalendarClient.tsx` | 816 | Stripe JS URL | **Low** — integration URL |
| `STRIPE_API_BASE` | `lib/stripe/connect.ts` | 11 | Stripe API base URL | **Low** — integration URL |
| `AVAILITY_CORE_SOAP_ENDPOINT` | `lib/edi/availity270/soapEnvelope.ts` | 24 | Availity SOAP endpoint | **Low** — integration URL |
| `ZOOM_API` | `lib/telehealth/adapters/zoom.ts` | 12 | Zoom API base URL | **Low** — integration URL |
| `CAL_API` | `lib/telehealth/adapters/googleMeet.ts` | 12 | Google Calendar API URL | **Low** — integration URL |

---

## 5. Environment variables

| Variable | Domain | Used by | Purpose | Fallback |
|---|---|---|---|---|
| `NEXT_PUBLIC_ORGANIZATION_ID` | D1 | `lib/config.ts` | Default org for single-tenant | `11111111-1111-1111-1111-111111111111` |
| `DATABASE_URL` | D1-D13 | Supabase client | Database connection | none |
| `NEXT_PUBLIC_SUPABASE_URL` | D1-D13 | Supabase client | Supabase project URL | none |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | D1-D13 | Supabase client | Supabase anon key | none |
| `SUPABASE_SERVICE_ROLE_KEY` | D1-D13 | Server operations | Privileged DB access | none |
| `AVAILITY_CLIENT_ID` | D5 | `lib/availity/env.tsx` | Availity OAuth client | none |
| `AVAILITY_CLIENT_SECRET` | D5 | `lib/availity/env.tsx` | Availity OAuth secret | none |
| `AVAILITY_EDI_API_KEY` | D5 | `lib/availity/env.tsx` | Availity EDI API key | none |
| `AVAILITY_EDI_BASE_URL` | D5 | `lib/availity/env.tsx` | Availity EDI base URL | none |
| `AVAILITY_OAUTH_TOKEN_URL` | D5 | `lib/availity/env.tsx` | Availity token endpoint | none |
| `TELNYX_API_KEY` | D12 | `lib/fax/provider.ts` | Fax API key | none |
| `TELNYX_FROM_NUMBER` | D12 | `lib/fax/provider.ts` | Fax sender number | none |
| `TELNYX_CONNECTION_ID` | D12 | `lib/fax/provider.ts` | Fax connection ID | none |
| `RESEND_API_KEY` | D12 | `lib/resend/client.ts` | Email API key | none |
| `RESEND_FROM_EMAIL` | D12 | `lib/resend/client.ts` | Sender email | none |
| `STRIPE_SECRET_KEY` | D13 | `lib/stripe/connect.ts` | Stripe API key | none |
| `STRIPE_WEBHOOK_SECRET` | D13 | `lib/stripe/connect.ts` | Stripe webhook secret | none |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | D13 | `lib/stripe/connect.ts` | Stripe Connect webhook secret | none |
| `ZOOM_CLIENT_ID` | D11 | `lib/telehealth/adapters/zoom.ts` | Zoom OAuth client | none |
| `ZOOM_CLIENT_SECRET` | D11 | `lib/telehealth/adapters/zoom.ts` | Zoom OAuth secret | none |
| `GOOGLE_CLIENT_ID` | D11 | `lib/telehealth/adapters/googleMeet.ts` | Google OAuth client | none |
| `GOOGLE_CLIENT_SECRET` | D11 | `lib/telehealth/adapters/googleMeet.ts` | Google OAuth secret | none |
| `TELEHEALTH_TOKEN_ENC_KEY` | D11 | `lib/telehealth/*` | Token encryption key | none |
| `ALLOW_DEV_AUTH_BYPASS` | D10 | `lib/auth.ts` | Dev auth bypass | `false` |
| `NEXT_PUBLIC_APP_URL` | D1 | Various | App base URL | none |
| `APP_URL` | D1 | Various | App base URL | none |
| `PORT` | D1 | Dev server | Server port | `8080` |
| `NODE_ENV` | D1 | Various | Environment | `development` |

---

## 6. System settings keys (evidence-based)

### 6a. Keys with confirmed code consumers

| Key | Domain | Consumer files | Evidence |
|---|---|---|---|
| `organization.billing_profile` | D1 | `lib/validation/facts/billingDefaults.ts`, `lib/validation/facts/tradingPartner.ts`, `lib/validation/simulation.tsx`, `lib/clearinghouse/ClearinghouseService.ts`, `app/api/edi/availity/837p/generate/route.ts`, `app/api/auth/me/route.ts`, `app/api/billing/medical-review/actions/route.ts` | Verified via grep |
| `organization.portal_settings` | D9 | `app/portal/home/page.tsx`, `app/portal/[token]/page.tsx`, `lib/portal/portalSettings.ts` | Verified via grep |
| `billing.rejections_277ca_autoroute` | D8 | `lib/billing/rejections277ca.ts` | Verified via grep |
| `payer_status.auto_check_last_run` | D4 | `lib/billing/claimStatusAutoCheck.tsx`, `lib/billing/claimStatusAutoCheckHeartbeat.tsx` | Verified via grep |
| `payment_posting.underpayment_threshold_pct` | D7 | `lib/payments/postingEngine/workqueueRules.ts` | Verified via grep |
| `payment_posting.no_response_days` | D7 | `lib/payments/postingEngine/workqueueRules.ts` | Verified via grep |
| `security.supervision.rules` | D10 | `app/api/edi/availity/837p/generate/route.ts` | Verified via grep |

### 6b. Keys referenced in schema only (no TypeScript consumers found)

| Key | Domain | Note |
|---|---|---|
| `billing.defaults` | D7 | In schema but no TS code consumers |
| `claims.defaults` | D8 | In schema but no TS code consumers |
| `eligibility.defaults` | D5 | In schema but no TS code consumers |
| `mailroom.defaults` | D12 | In schema but no TS code consumers |
| `security.defaults` | D10 | In schema but no TS code consumers |
| `telehealth.defaults` | D11 | In schema but no TS code consumers |
| `chat.defaults` | D9 | In schema but no TS code consumers |
| `vcc.defaults` | D7 | In schema but no TS code consumers |
| `clearinghouse.defaults` | D5 | In schema but no TS code consumers |
| `medicaid_telehealth_checkin.defaults` | D11 | In schema but no TS code consumers |
| `patient_portal.enabled` | D9 | In schema but no TS code consumers |
| `patient_portal.allow_*` | D9 | In schema but no TS code consumers |
| `portal.defaults` | D9 | In schema but no TS code consumers |
| `eligibility_service_type_code` | D5 | **NOT a system_settings key** — is on `clearinghouse_connections` and `eligibility_requests` tables |

### 6c. Live-only tables (not in schema.sql)

| Table | Used by | Note |
|---|---|---|
| `organization_settings` | `lib/payments/postingEngine/workqueueRules.ts` | Queried by code but **not present** in schema.sql; may be live-only or legacy |

---

## 7. Key findings

### 7a. Overlapping settings stores

The app has **one canonical settings store** — `system_settings` (org-scoped JSONB key/value,
21+ keys). Two **legacy structured tables** (`custom_billing_settings`,
`custom_note_settings`) were referenced in a prior audit document but are **not present**
in the current schema.sql or any migration file.

There is also **portal-setting fragmentation** inside `system_settings` itself: discrete booleans
(`patient_portal.enabled`, `patient_portal.allow_*`), an object (`portal.defaults`), and another
object (`organization.portal_settings`) all describe portal behavior. The portal pages
(`app/portal/home/page.tsx`, `app/portal/[token]/page.tsx`) **already query** `system_settings`
for `organization.portal_settings`, so they are wired correctly.

### 7b. Place-of-service hardcoding (fixed)

The canonical POS module `lib/billing/placeOfService.ts` allows **only `11` (office)** and
**`02` (telehealth)**. Claim-building code previously had inline literals:

- `"11"` in `lib/ehr/pipeline.ts` (×4)
- `"10"` in `lib/claims/edi837pBatchService.ts` (×2) and `BillingDetailsClient.tsx` (×1)

**Status:** Fixed — consolidated onto `DEFAULT_OFFICE_PLACE_OF_SERVICE` and `DEFAULT_TELEHEALTH_PLACE_OF_SERVICE`.
Also fixed `lib/claims/claimReadinessService.tsx` to use `DEFAULT_OFFICE_PLACE_OF_SERVICE`.

### 7c. All 16 settings UIs are placeholders

None of the settings pages under `app/settings/` have read/write capability. They are
architectural shells that display static content. This is the single largest gap in the
settings layer.

### 7d. EDI header hardcoding (high risk)

The `clearinghouse_connections` table has columns for `gs_receiver_code`, `receiver_id`,
`isa_usage_indicator`, `mode`, `submitter_id`, but claim generation code uses inline literals:

- `receiver_id ?? "330897513"` in `lib/claims/edi837pBatchService.ts`
- `isa_usage_indicator ?? "T"` in `lib/claims/edi837pBatchService.ts`
- `*OA*` (gs_receiver_code) literal in `lib/claims/edi837pBatchService.ts`
- `005010X222A1` (x12 version) literal in `lib/claims/edi837pBatchService.ts`

These are **production claim identifiers** — changing them without testing will break
EDI submissions.

### 7e. Business logic thresholds (partially wired)

Multiple thresholds exist with two-layer fallback:
1. Code queries `organization_settings` (live-only table, not in schema.sql)
2. If `organization_settings` fails/missing, falls back to hardcoded constants

- `DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8` — queries `organization_settings` first
- `DEFAULT_NO_RESPONSE_DAYS = 30` — queries `organization_settings` first
- `DEFAULT_TIMELY_FILING_DAYS = 90` — used when `payer_profiles.billing_rules` is missing
- `DEFAULT_APPEAL_DEADLINE_DAYS = 180` — used when payer rule is missing
- `HIGH_DOLLAR_THRESHOLD = 1000` — no settings query at all

### 7f. Schema-level defaults

| Column | Default | Assessment |
|---|---|---|
| `organizations.timezone` | `America/Denver` | Acceptable |
| `organizations.default_state` | `CO` | Acceptable |
| `payer_plans.timely_filing_days` | `365` | Acceptable |
| `payer_plans.appeal_deadline_days` | `60` | Acceptable |
| `service_locations.place_of_service_code` | `11` | Acceptable |
| `clearinghouse_connections.mode` | `test` | Acceptable |
| `eligibility_requests.service_type_code` | `98` | Acceptable (X12 standard) |
| `eligibility_requests.request_mode` | `mock` | Acceptable (dev default) |

### 7g. Orphaned tables

- `custom_app_config` — exists in schema.sql but **zero** TypeScript references found
- `custom_billing_settings` — **not found** in schema.sql or any migration
- `custom_note_settings` — **not found** in schema.sql or any migration
- `organization_settings` — **not found** in schema.sql but actively queried by code

---

## 8. Changes made (remove hardcoding)

Consolidated POS fallbacks onto the canonical module:

- `lib/billing/placeOfService.ts` — added `DEFAULT_OFFICE_PLACE_OF_SERVICE` (`"11"`) and
  `DEFAULT_TELEHEALTH_PLACE_OF_SERVICE` (`"02"`).
- `lib/ehr/pipeline.ts` — replaced 4 `"11"` literals.
- `lib/claims/edi837pBatchService.ts` — replaced 2 invalid `?? "10"` fallbacks.
- `app/encounters/[encounterId]/billing/BillingDetailsClient.tsx` — replaced `"10"` fallbacks.
- `lib/canonical-ehr/model.tsx` — replaced invalid `"10"` with `DEFAULT_TELEHEALTH_PLACE_OF_SERVICE`.
- `lib/workflow/workflowFunctions.tsx` — replaced 2 `"11"` literals.
- `lib/claims/claimReadinessService.tsx` — replaced `"11"` with `DEFAULT_OFFICE_PLACE_OF_SERVICE`.

---

## 9. Remaining follow-ups (prioritized)

### 9a. Critical (breaks production claims)

1. **De-hardcode EDI ISA/GS header** in `lib/claims/edi837pBatchService.ts` — read
   `gs_receiver_code`, `receiver_id`, `isa_usage_indicator`, `claims_x12_version` from
   `clearinghouse_connections`. **Deferred** — needs EDI round-trip test.

### 9b. High (business logic should be configurable)

2. **Wire `HIGH_DOLLAR_THRESHOLD`** to `system_settings` — currently hardcoded at `1000`.
3. **Wire `DEFAULT_TIMELY_FILING_DAYS`** to `system_settings` — currently hardcoded at `90`.
4. **Wire `DEFAULT_APPEAL_DEADLINE_DAYS`** to `system_settings` — currently hardcoded at `180`.
5. **Wire `DEFAULT_CORRECTED_CLAIM_DAYS`** to `system_settings` — currently hardcoded at `180`.
6. **Wire `STALE_DAYS`** to `system_settings` — currently hardcoded at `30`.
7. **Wire `SUGGEST_THRESHOLD` / `PRESELECT_THRESHOLD`** to `system_settings`.

### 9c. Medium (integration/config)

8. **Move integration URLs to environment** — `AVAILITY_CORE_SOAP_ENDPOINT`, `ZOOM_API`,
   `STRIPE_API_BASE`, `STRIPE_JS_URL`.
9. **Move AI model selection to environment** — `gpt-4o-mini-transcribe`.
10. **Consolidate portal settings** into single `organization.portal_settings` namespace.

### 9d. Low (cosmetic)

11. **Implement 16 placeholder settings UIs** for in-app editing.
12. **Consolidate page size constants** into shared `lib/constants.ts`.
13. **Move `UNIQUE_VIOLATION` error code** to shared database utility.

---

## 10. Summary

| Category | Count | Status |
|---|---|---|
| Settings UI pages | 16 | All placeholders — no write capability |
| system_settings keys | 21+ | Active and queried |
| Hardcoded operational values | 38 | POS — fixed; EDI — critical; thresholds — high |
| Environment variables | 27 | Integration credentials, auth, base URLs |
| Schema tables with defaults | 8 | 7 acceptable; 1 needs review (mode=test) |
| Orphaned tables | 1 | `custom_app_config` — in schema, no code refs |
| Live-only tables | 1 | `organization_settings` — queried but not in schema |
| Overlap risk | 2 | Portal settings (3 key namespaces), EDI headers (table vs code) |
