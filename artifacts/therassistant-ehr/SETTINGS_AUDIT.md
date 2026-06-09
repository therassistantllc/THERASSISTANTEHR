# Settings Control-Layer Audit

**Scope:** Map every settings/configuration surface in TherAssistant EHR, identify the
canonical source of truth for each, find hardcoded fallbacks and overlapping/duplicated
settings behavior, then remove hardcoding where it is safe to do so.

**Method:** Inspected the **live Supabase schema** (`information_schema` + `system_settings`
contents) — not migration files — and read the actual consuming code. Findings below reflect
what is in the running database and code as of this audit.

---

## 1. Audit matrix

| Setting area | UI page | API route | Table / source | Used by | Hardcoded fallback? | Canonical location | Fix needed |
|---|---|---|---|---|---|---|---|
| Org billing profile (NPI, EIN/Tax ID, billing address, authorized rep) | `/settings/billing-defaults`, `/settings/trading-partner` (both **placeholder**, no read/write) | none (seeded) | `system_settings` key `organization.billing_profile` (JSONB) | `lib/validation/facts/billingDefaults.ts`, `lib/validation/facts/tradingPartner.ts`, claim Box 33 readiness | No — empty `{}` fallback, no fabricated values | `system_settings['organization.billing_profile']` | Build the placeholder UIs to write this key |
| Org profile (name, timezone, default state, submitter id) | `/settings/organizations` (**placeholder**) | `/api/organizations/[orgId]` GET/PATCH | `organizations` | claim/EDI headers, readiness | DB defaults: `timezone='America/Denver'`, `default_state='CO'`, **`submitter_id='1082546'`** | `organizations` row | `submitter_id` default is a real Office Ally submitter ID baked as a **column default** — should be set per-org, not defaulted in schema |
| Default organization id | n/a | all org-scoped routes | `lib/config.ts` `DEFAULT_ORG_ID` | every page/route via `ORGANIZATION_ID` | **Yes** — `11111111-1111-1111-1111-111111111111` when `NEXT_PUBLIC_ORGANIZATION_ID` unset | env `NEXT_PUBLIC_ORGANIZATION_ID` | Acceptable single-tenant dev fallback; documented (also used by the dev auth bypass) |
| **Place of service (POS)** | encounter note / charge capture / billing details (client pages) | encounter & charge-capture routes | `service_locations.place_of_service_code` (default `'11'`, `is_default` flag) + canonical helper `lib/billing/placeOfService.ts` (allowed: `11`, `02`) | `lib/ehr/pipeline.ts`, `lib/claims/edi837pBatchService.ts`, claim readiness, `lib/edi/availity837p/*` | **Yes — scattered**: `"11"` literals in `pipeline.ts` (×4); **invalid `"10"`** fallbacks in `edi837pBatchService.ts` (×2) and `BillingDetailsClient.tsx` (×1) | `lib/billing/placeOfService.ts` | **FIXED** — consolidated onto `DEFAULT_OFFICE_PLACE_OF_SERVICE`; removed invalid `"10"` |
| Clearinghouse / EDI transport | `/settings/clearinghouse`, `/settings/edi` (**placeholder**) | `/api/integrations/availity/token-test` | `clearinghouse_connections` (columns w/ defaults: `clearinghouse_name='availity'`, `receiver_name='OFFICEALLY'`, `gs_receiver_code='OA'`, `sender_qualifier='ZZ'`, `receiver_qualifier='30'`, `isa_usage_indicator='T'`, x12 version columns) | `lib/claims/edi837pBatchService.ts` ISA/GS builder, `lib/clearinghouse/*`, eligibility | **Yes** — `receiver_id ?? "330897513"`, `isa_usage_indicator ?? "T"`, literal `*OA*` (gs_receiver_code), literal `005010X222A1` (x12 version) despite DB columns existing | `clearinghouse_connections` row | **Recommended follow-up** — read `gs_receiver_code` / `claims_x12_version` / qualifiers from the connection; needs EDI round-trip test before changing |
| Payer plans / timely filing | `/settings/payers`, `/settings/payer-enrollments` (**placeholder**) | none structured | `payer_plans.timely_filing_days` (default `365`), `payer_enrollments` | timely-filing checks, enrollment gate | DB default `365` | `payer_plans` row | Acceptable default; documented |
| Patient portal | `/settings/portal` (**placeholder**) | portal routes | `system_settings` keys `patient_portal.*` (booleans), `portal.defaults` (object), `organization.portal_settings` (object) | portal pages, `lib/portal/portalSettings.ts` (`DEFAULT_PORTAL_SETTINGS`) | Yes — `DEFAULT_PORTAL_SETTINGS` (reasonable code defaults) | `system_settings['organization.portal_settings']` | **Overlap**: three portal-related key namespaces; consolidate and build portal UI |
| Staff notification prefs | n/a | `/api/billing/notification-preferences` GET/POST | `staff_notification_preferences` (defaults `true`) | eligibility routing alerts | DB defaults `true` | that table | OK |
| Org-scoped defaults bucket | various placeholders | none | `system_settings` keys: `billing.defaults`, `claims.defaults`, `eligibility.defaults`, `mailroom.defaults`, `security.defaults`, `telehealth.defaults`, `chat.defaults`, `vcc.defaults`, `clearinghouse.defaults`, `medicaid_telehealth_checkin.defaults`, `billing.rejections_277ca_autoroute`, `eligibility_service_type_code` | respective feature flows | code defaults where keys missing | `system_settings` (canonical store) | OK — this is the intended settings store |
| ~~Orphaned: `custom_billing_settings`~~ | none | none | ~~`custom_billing_settings`~~ — **not present in current schema.sql** | nothing (had zero code refs) | n/a | `system_settings['billing.defaults']` | No migration needed for schema.sql; **defensive idempotent migration added** (`20260609201218_drop_orphaned_custom_settings_tables.sql`) for environments with legacy drift |
| ~~Orphaned: `custom_note_settings`~~ | none | none | ~~`custom_note_settings`~~ — **not present in current schema.sql** | nothing (had zero code refs) | n/a | a `system_settings` note key | No migration needed for schema.sql; **defensive idempotent migration added** for environments with legacy drift |

---

## 2. Key findings

### 2a. Overlapping settings stores

The app has **one canonical settings store** — `system_settings` (org-scoped JSONB key/value,
19 live keys). Two **legacy structured tables** (`custom_billing_settings`,
`custom_note_settings`) were referenced in a prior audit document but are **not present**
in the current schema.sql. They may have existed in a pre-v0 schema and were already
removed before this codebase snapshot. To cover any environment where they still exist
from legacy drift, a **defensive idempotent migration** (`20260609201218_drop_orphaned_custom_settings_tables.sql`)
was added to safely drop them.

There is also **portal-setting fragmentation** inside `system_settings` itself: discrete booleans
(`patient_portal.enabled`, `patient_portal.allow_*`), an object (`portal.defaults`), and another
object (`organization.portal_settings`) all describe portal behavior. The portal pages
(`app/portal/home/page.tsx`, `app/portal/[token]/page.tsx`) **already query** `system_settings`
for `organization.portal_settings`, so they are wired correctly.

### 2b. Place-of-service hardcoding (with a latent bug)

The canonical POS module `lib/billing/placeOfService.ts` allows **only `11` (office)** and
**`02` (telehealth)**, and `placeOfServiceWarning` **explicitly rejects `10`**. Despite this,
claim-building code fell back to inline literals:

- `"11"` in `lib/ehr/pipeline.ts` (×4) — duplicated magic constant.
- **`"10"`** in `lib/claims/edi837pBatchService.ts` (×2) and `BillingDetailsClient.tsx` (×1) —
  a missing POS would produce an 837P/UI value that the app's **own validation gate rejects**.

---

## 3. Changes made (remove hardcoding)

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

## 4. Remaining follow-ups

1. **De-hardcode the EDI ISA/GS header** in `lib/claims/edi837pBatchService.ts` — read
   `gs_receiver_code`, `claims_x12_version`, `receiver_qualifier`, and `receiver_id` from the
   `clearinghouse_connections` row instead of literals. Deferred because it changes generated X12
   and needs a clearinghouse round-trip test.
2. **Move `organizations.submitter_id` default off the schema** — `'1082546'` is a real submitter
   ID baked as a column default; it should be set per organization, not defaulted.
3. **Consolidate portal settings** into a single `organization.portal_settings` object and migrate
   the discrete `patient_portal.*` / `portal.defaults` keys.
4. **Implement the placeholder settings UIs** so these values are editable in-app rather than
   seeded directly into the database.
