---
name: Dual payer tables (insurance_payers vs payer_profiles)
description: TherassistantEHR has two separate payer tables that are NOT interchangeable as FK targets.
---

There are two payer tables in the public schema and they live on opposite sides of the clinical/billing split.

- `insurance_payers` — referenced by `insurance_policies.payer_id`. Clinical/eligibility side. Columns: `payer_name`, `payer_id` (Availity/RTE id), `payer_category`, `claims_address`, etc.
- `payer_profiles` — referenced by `professional_claims.payer_profile_id` (and most billing/claim tables). Billing side. Columns: `payer_name`, `availity_payer_id`, `payer_type`, `billing_rules`, etc.

**Why:** historical split — eligibility/RTE was wired up against `insurance_payers` first; the claims/billing surface was rebuilt later against `payer_profiles` with richer billing metadata. The two tables overlap in name but are not joined and have different row sets (e.g. `Demo Payer` exists in both with different UUIDs).

**How to apply:**
- When inserting an `insurance_policy`, pick a row from `insurance_payers` for `payer_id`.
- When inserting a `professional_claim` (or anything billing-side that wants a payer), pick a row from `payer_profiles` for `payer_profile_id`.
- Do not assume the same UUID exists in both tables; do not try to FK across them.
- If you need a single "payer" concept for a UI, you must read both and reconcile by `payer_name` / `availity_payer_id`.
