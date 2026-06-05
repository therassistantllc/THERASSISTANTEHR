# Billing Portfolio + Claimless ERA Changes

Prepared for `therassistantllc/THERASSISTANTEHR`, app subpath `artifacts/therassistant-ehr`.

## What changed

- Claimless/imported ERA rows can be matched to a client and posted to the patient account ledger without creating a client credit.
- ERA posting logs the full equation: CLP03 charge, CLP04 insurance payment, CAS adjustments with group/reason/source segment, CLP05 patient responsibility, and audit totals.
- Service-line CAS reason codes are included in posting validation/audit/ledger detail, not just claim-level CAS.
- PR CAS rows are recorded as patient-responsibility detail with zero ledger balance effect, so deductible/copay/coinsurance codes do not erase the patient balance.
- Manual payment adjustments accept custom group codes, reason codes, references, and audit them.
- Bulk endpoints support portfolio-wide payment adjustments, corrected claims, 277CA actions, and 999 rebill/correction actions across delegated organizations.
- Billing-company portfolio access is backed by `billing_company_organization_access` and enforced by `requireBillingPortfolioAccess`.
- Imported 835/Availity ERA flows now write canonical ERA batches/payments/service lines and bridge importer rows to canonical posting.
- Added `/billing/payments/posted` and improved ERA payment/posting UI readiness for claimless patient-ledger posting.

## Local verification

- Static scans found no remaining direct `source_object_type: "era_claim_payment"` workqueue writes, stale importer-post fallback strings, or stale claimless-credit helper strings.
- Smoke-tested claimless residual math for deductible PR CAS, contractual-plus-PR, and denial writeoff cases.
- Could not run `pnpm typecheck`, tests, lint, or build because this extracted app has no `node_modules`, and `git`, `gh`, `pnpm`, `npm`, and `corepack` are unavailable in this environment.

## GitHub publishing status

- Current GitHub `main` commit checked: `baeba0a17c6751cd76c580a5425294ee465a1b60`.
- Base tree SHA checked: `60fbcd2085a7394d13fcfbfc1b4f5760aef69c8a`.
- The GitHub connector can write blobs/trees, but local file content transfer through this projectless shell truncates on larger changed files. No local git/gh binary or token is available for the normal push flow.

The accompanying zip contains the exact changed files under `artifacts/therassistant-ehr/`.
