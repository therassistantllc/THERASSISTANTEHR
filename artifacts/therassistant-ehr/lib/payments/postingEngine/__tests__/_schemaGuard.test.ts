/**
 * Self-test for the schema-aware fake-supabase guard (Task #179).
 *
 * Confirms the regression class that Task #140 hit in production now
 * fails loudly at test time:
 *   - unknown column names on a real table
 *   - enum values outside the runtime `Constants.public.Enums` set
 *
 * Also verifies that tables not present in the schema (e.g. ad-hoc
 * helper tables some fakes seed) are passed through, so existing
 * test fixtures keep working.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { SchemaGuardError, validateWritePayload } from "./_schemaGuard";

describe("schemaGuard", () => {
  it("accepts a valid workqueue_items insert payload", () => {
    assert.doesNotThrow(() =>
      validateWritePayload("workqueue_items", {
        organization_id: "org-1",
        source_object_type: "claim",
        source_object_id: "claim-1",
        client_id: "c-1",
        priority: "normal",
        status: "open",
        work_type: "no_response",
        title: "x",
      }),
    );
  });

  it("rejects the Task #140 column-name regression (patient_id, queue_type)", () => {
    assert.throws(
      () =>
        validateWritePayload("workqueue_items", {
          organization_id: "org-1",
          patient_id: "c-1",
          queue_type: "no_response",
        }),
      SchemaGuardError,
    );
  });

  it("rejects an out-of-enum source_object_type value", () => {
    assert.throws(
      () =>
        validateWritePayload("workqueue_items", {
          organization_id: "org-1",
          source_object_type: "professional_claim",
          source_object_id: "claim-1",
        }),
      /invalid enum value 'professional_claim'/,
    );
  });

  it("rejects an out-of-enum workqueue_status value", () => {
    assert.throws(
      () =>
        validateWritePayload("workqueue_items", {
          status: "cancelled",
        }),
      /invalid enum value 'cancelled'/,
    );
  });

  it("knows about columns added by post-types migrations (overlay)", () => {
    assert.doesNotThrow(() =>
      validateWritePayload("era_claim_payments", {
        reversed_at: "2026-05-24T00:00:00Z",
        reversal_reason: "test",
        voided_at: null,
      }),
    );
    assert.doesNotThrow(() =>
      validateWritePayload("payment_refunds", {
        organization_id: "org-1",
        refund_type: "insurance",
        amount: 10,
        refund_status: "pending",
        source_era_claim_payment_id: "era-1",
      }),
    );
  });

  it("passes through tables that aren't in the schema", () => {
    assert.doesNotThrow(() =>
      validateWritePayload("__not_a_real_table__", { whatever: 1 }),
    );
  });
});
