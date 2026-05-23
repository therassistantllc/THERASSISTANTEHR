/**
 * Unit tests for patient_payment transferred_balance validation
 * (Task #109 PP-3, response to code-review gap on paired transfer entries).
 *
 * The commit-path side (payment_transfers row + paired ledger + balance
 * shift on source) is covered by the E2E test in patientPaymentE2E.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePatientPayment } from "../postingEngine/patientPayment";

const actor = { staffId: null, userId: null, role: "biller", source: "test" };

test("blocks transferred_balance with no source", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 50,
    method: "transferred_balance",
    applyTo: { kind: "invoice", patientInvoiceId: "inv-2" },
    actor,
  });
  assert.ok(r.blocking.some((b) => b.code === "transfer_source_required"));
});

test("blocks transferred_balance with account_balance destination", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 50,
    method: "transferred_balance",
    applyTo: { kind: "account_balance" },
    transferFrom: { fromInvoiceId: "inv-1" },
    actor,
  });
  assert.ok(r.blocking.some((b) => b.code === "transfer_destination_required"));
});

test("accepts transferred_balance with a source and a specific destination", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 50,
    method: "transferred_balance",
    applyTo: { kind: "invoice", patientInvoiceId: "inv-2" },
    transferFrom: { fromInvoiceId: "inv-1" },
    actor,
  });
  assert.equal(r.blocking.length, 0);
});
