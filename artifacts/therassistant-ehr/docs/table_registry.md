# Table Registry

This registry tracks the status of Supabase tables. Only drop tables in the **legacy/duplicate** category after verifying they are unused and taking a backup.

| Table | Status | Notes |
|---|---|---|
| professional_claims | runtime‑wired | Core claim record. Used throughout billing and ERA posting. |
| claim_notes | runtime‑wired | Created in 20260605000000_billing_workflow_redesign.sql【19file0†L3-L11】. Stores per‑claim notes. |
| workqueue_items | runtime‑wired | Canonical workqueue table. Supersedes claim_workqueue_items. |
| provider_profiles | runtime‑wired | Provider profile table【20file0†L5-L23】. Use for providers. |
| claim_workqueue_items | legacy/duplicate | Not created in migrations; replace with workqueue_items. |
| patient_check_ins | legacy/duplicate | Superseded by patient_checkins table. |
| tickets | legacy/duplicate | Superseded by support_tickets. |
| support_tickets | planned | Placeholder for a ticketing system. |
| clinical_forms | planned | Clinical form engine tables exist but are unused. |
| clinical_form_fields | planned | Clinical form field definitions. |
| custom_invoice | legacy/duplicate | Replace with real ledger tables. |
| custom_payment | legacy/duplicate | Replace with real ledger tables. |
| payer_profiles | runtime‑wired | Standard payer profile table. |
| provider_credentialing_profiles | runtime‑wired | Telehealth/credentialing information. |
| payer_contracts | migration‑only | Configuration tables not yet used in code. |