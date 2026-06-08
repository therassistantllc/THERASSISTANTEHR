---
name: ERA take-back auto-detection
description: Auto-seeding payment_recoupments from incoming 835s — what counts as a take-back, what NOT to gate on it, and where idempotency hides.
---

## What counts as a payer take-back in an 835

Two signal classes — auto-ingest should fire on EITHER:

1. **PLB segments** with adjustment reason codes `WO`, `FB`, `J1`, `72` AND PLB04 amount > 0. PLB04 is signed: positive = money pulled back from the provider. PLB03 is a composite `reasonCode>refId`; the refId (right of `:` or `>`) is the original payer claim control number being recouped.
2. **CLP reversals** — `CLP02='22'` OR `CLP04 < 0` (the negative-pay reversal claim within the same ERA). Either signal alone is sufficient; many payers send only the negative CLP04 with no CLP02.

## Source / offset matching

Resolve the source `era_claim_payments` by payer claim control number first (CLP07 / PLB03 right-half), then by provider-side `clp01_claim_control_number`, then by the SAME batch (covers the case where the payer sends original and reversal in one remit). Without any match, surface as a warning — do not block the batch.

Offset = largest positive-pay `era_claim_payments.id` in the current batch (skip if equal to the source row). Null when the batch has no positive pays (refund-due scenario).

## Do NOT call recordRecoupment for auto-ingest

`recordRecoupment` enforces `source.posting_status === 'posted'` — a biller-initiated guardrail. Auto-ingest can fire before/regardless of the posting flow; routing through that engine drops legitimate take-back signals on the floor. Insert directly into `payment_recoupments` and rely on the idempotency key instead.

**Why:** the posting-status gate exists to stop billers from recouping against still-open payments interactively. It is the wrong gate for ingest-time detection.

## Idempotency landmines

The natural dedupe key is `(organization_id, source_era_claim_payment_id, amount, reason_code)`. Two non-obvious traps:

- `reason_code` is NULLABLE. A CLP04<0 reversal with no CLP02 stores `reason_code = NULL`. The dedupe lookup MUST use `.is("reason_code", null)` when the signal's reason is null — `.eq("reason_code", "")` will never match a persisted NULL and replay creates duplicates.
- `archived_at IS NULL` must be part of every dedupe lookup so soft-deleted reversals don't suppress a fresh take-back.

**Why:** the original review caught this exact regression. The "never doubles" invariant is what the user is buying when they let auto-ingest seed the queue; null-handling asymmetry breaks it silently.

## Take-back failures must NOT block batch import status

Take-back detection is a best-effort POST-pass to per-claim posting. Unmatched references (unknown PCN) and transient workqueue insert failures are warnings, not errors. Compute `import_status` from the per-claim posting errors only, BEFORE running the detector. Surface take-back failures on a separate `warnings` field on the batch result.

**Why:** otherwise a payer sending a recoupment we can't match would downgrade an otherwise-clean batch to `blocked`, forcing operations to hand-unblock perfectly good ERAs.

## Workqueue hookup

Call `applyWorkqueueRules` with `sourceKind: 'recoupment'`, `sourceObjectType: 'payment_recoupment'`. The rule engine maps the logical kind to the `payment_posting` enum (see `workqueue-items-schema.md`) and the recoupment rule emits a `recoupment` work_type. Link the created `workqueue_items.id` back onto `payment_recoupments.workqueue_item_id` so the queue row resolves directly to the take-back.

**How to apply:** any new ERA-ingest path (e.g. Availity polling cron) must run the same detector after persisting era_claim_payments, and must pass warnings through to the caller separately from posting errors — or it will silently drop payer take-back signals AND/OR jam batch status on benign anomalies.
