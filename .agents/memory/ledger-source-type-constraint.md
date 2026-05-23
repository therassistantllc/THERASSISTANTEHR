---
name: era_posting_ledger source_type constraint
description: era_posting_ledger_entries.source_type is gated by a check constraint; any new poster type (payment_transfer, refund_reversal, etc.) must drop+re-add the constraint, not just `if not exists … add`.
---

The `era_posting_ledger_source_type_check` constraint enumerates the allowed `source_type` values for ledger writes. The original migration used `if not exists … add constraint`, which means a later migration that just re-runs the same pattern will silently NOT widen the set — the constraint already exists with the old list and the new value will fail at insert time.

**Why:** PP-3 added a `payment_transfer` ledger entry for paired transferred_balance writes. It passed unit tests against an in-memory fake but would have failed in production because the real constraint still listed only `('era_835','manual_insurance','patient_payment','recoupment','refund','reversal')`.

**How to apply:** When introducing a new `source_type`, write a migration that DROPs the constraint if it exists, then ADDs it with the widened list (see `20260523020000_ledger_allow_payment_transfer.sql`). Same pattern applies to any other enumerated-via-CHECK column in this schema.
