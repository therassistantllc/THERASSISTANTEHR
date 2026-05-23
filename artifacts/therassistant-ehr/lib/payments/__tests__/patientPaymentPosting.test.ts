/**
 * Unit tests for the patient_payment posting validator (pure).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePatientPayment } from "../postingEngine/patientPayment";
import type { PostingActor } from "../postingEngine/types";

const actor: PostingActor = {
  staffId: "staff-1",
  userId: "user-1",
  role: "biller",
  source: "test",
};

test("blocks zero/negative amount and missing client", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "",
    amount: 0,
    method: "cash",
    applyTo: { kind: "account_balance" },
    actor,
  });
  assert.ok(r.blocking.some((b) => b.code === "amount_required"));
  assert.ok(r.blocking.some((b) => b.code === "client_required"));
});

test("warns when stripe / external_card method has no external_payment_id", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 50,
    method: "stripe",
    applyTo: { kind: "invoice", patientInvoiceId: "inv-1" },
    actor,
  });
  assert.equal(r.blocking.length, 0);
  assert.ok(r.warning.some((w) => w.code === "external_payment_id_missing"));
});

test("blocks refund method via intake (PP-4 routes refunds through posted-payment endpoint)", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 25,
    method: "refund",
    applyTo: { kind: "account_balance" },
    actor,
  });
  assert.ok(r.blocking.some((b) => b.code === "refund_via_intake_blocked"));
});

test("clean cash payment to account_balance passes", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 100,
    method: "cash",
    applyTo: { kind: "account_balance" },
    actor,
  });
  assert.equal(r.blocking.length, 0);
  assert.equal(r.warning.length, 0);
});

test("stripe payment with external_payment_id is clean", () => {
  const r = validatePatientPayment({
    organizationId: "org-1",
    clientId: "client-1",
    amount: 200,
    method: "stripe",
    applyTo: { kind: "invoice", patientInvoiceId: "inv-1" },
    externalPaymentId: "ch_abc123",
    actor,
  });
  assert.equal(r.blocking.length, 0);
  assert.equal(r.warning.length, 0);
});
