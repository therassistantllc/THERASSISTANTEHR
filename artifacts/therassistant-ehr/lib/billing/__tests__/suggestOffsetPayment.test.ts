import { describe, it, expect } from "vitest";
import {
  extractPlbReference,
  scoreOffsetCandidate,
  suggestOffsetPayment,
  PRESELECT_THRESHOLD,
  SUGGEST_THRESHOLD,
  type SuggestionPaymentInput,
  type SuggestionRowInput,
} from "../suggestOffsetPayment";

function payment(
  overrides: Partial<SuggestionPaymentInput> & { id: string },
): SuggestionPaymentInput {
  return {
    id: overrides.id,
    paymentAmount: overrides.paymentAmount ?? 0,
    checkNumber: overrides.checkNumber ?? null,
    importedAt: overrides.importedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-05-01T00:00:00Z",
    payer: overrides.payer ?? { id: null, name: null },
  };
}

function row(overrides: Partial<SuggestionRowInput> = {}): SuggestionRowInput {
  return {
    recoupment_amount: 0,
    reason: null,
    reason_code: null,
    payer_profile_id: null,
    payer_name: null,
    notice_date: null,
    offset_era_claim_payment_id: null,
    ...overrides,
  };
}

describe("extractPlbReference", () => {
  it("pulls the ref token out of the standard PLB description", () => {
    expect(
      extractPlbReference("Provider-level take-back (PLB WO ref 1234)"),
    ).toBe("1234");
  });

  it("returns null when reason has no ref token", () => {
    expect(extractPlbReference("Payer reversal (CLP02=22) of claim X")).toBeNull();
    expect(extractPlbReference(null)).toBeNull();
    expect(extractPlbReference("")).toBeNull();
  });
});

describe("scoreOffsetCandidate", () => {
  it("scores the pre-detected offset id above every other signal", () => {
    const r = row({
      recoupment_amount: 100,
      offset_era_claim_payment_id: "pay-auto",
      payer_name: "Aetna",
      reason_code: "WO",
    });
    const result = scoreOffsetCandidate(r, payment({ id: "pay-auto", paymentAmount: 1, payer: { id: null, name: "Other" } }));
    expect(result?.score).toBeGreaterThanOrEqual(1000);
    expect(result?.reason).toMatch(/Auto-matched/i);
  });

  it("rewards PLB ref matching the check number", () => {
    const r = row({
      recoupment_amount: 50,
      reason: "Provider-level take-back (PLB WO ref 555)",
      payer_name: "Aetna",
    });
    const match = scoreOffsetCandidate(
      r,
      payment({ id: "p1", paymentAmount: 500, checkNumber: "555", payer: { id: null, name: "Aetna" } }),
    );
    const noMatch = scoreOffsetCandidate(
      r,
      payment({ id: "p2", paymentAmount: 500, checkNumber: "999", payer: { id: null, name: "Aetna" } }),
    );
    expect(match?.score ?? 0).toBeGreaterThan(noMatch?.score ?? 0);
    expect(match?.reason).toMatch(/PLB reference/i);
  });

  it("returns null for payments with no signal at all", () => {
    const r = row({ recoupment_amount: 100, payer_name: "Aetna" });
    expect(
      scoreOffsetCandidate(r, payment({ id: "p1", paymentAmount: 0, payer: { id: null, name: "Cigna" } })),
    ).toBeNull();
  });
});

describe("suggestOffsetPayment", () => {
  it("preselects an auto-detected PLB match over a same-payer candidate", () => {
    const r = row({
      recoupment_amount: 75,
      payer_profile_id: "payer-1",
      offset_era_claim_payment_id: "pay-auto",
      notice_date: "2026-05-20",
    });
    const result = suggestOffsetPayment(r, [
      payment({ id: "pay-auto", paymentAmount: 200, payer: { id: "payer-1", name: "Aetna" }, importedAt: "2026-05-19" }),
      payment({ id: "pay-other", paymentAmount: 75, payer: { id: "payer-1", name: "Aetna" }, importedAt: "2026-05-21" }),
    ]);
    expect(result.bestId).toBe("pay-auto");
    expect(result.shouldPreselect).toBe(true);
  });

  it("falls back to payer + amount + date heuristics when no auto offset exists", () => {
    const r = row({
      recoupment_amount: 120,
      payer_profile_id: "payer-1",
      payer_name: "Aetna",
      notice_date: "2026-05-15",
    });
    const result = suggestOffsetPayment(r, [
      // far date, wrong payer
      payment({ id: "p-far", paymentAmount: 200, payer: { id: "payer-2", name: "BCBS" }, importedAt: "2026-01-01" }),
      // same payer, amount covers takeback, close to notice
      payment({ id: "p-best", paymentAmount: 200, payer: { id: "payer-1", name: "Aetna" }, importedAt: "2026-05-18" }),
      // same payer, smaller amount, far from notice
      payment({ id: "p-weak", paymentAmount: 30, payer: { id: "payer-1", name: "Aetna" }, importedAt: "2025-12-01" }),
    ]);
    expect(result.bestId).toBe("p-best");
    expect(result.byId.get("p-best")?.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
  });

  it("does not preselect a weak candidate", () => {
    const r = row({
      recoupment_amount: 1000,
      payer_name: "Aetna",
      notice_date: "2026-05-20",
    });
    const result = suggestOffsetPayment(r, [
      // far date, wrong payer name, tiny amount — no signal at all
      payment({ id: "p1", paymentAmount: 5, payer: { id: null, name: "Cigna" }, importedAt: "2024-01-01" }),
    ]);
    expect(result.bestId).toBeNull();
    expect(result.shouldPreselect).toBe(false);
  });

  it("flags exact-amount same-payer matches with a useful reason", () => {
    const r = row({
      recoupment_amount: 250,
      payer_name: "Aetna",
      notice_date: "2026-05-20",
    });
    const result = suggestOffsetPayment(r, [
      payment({ id: "p-exact", paymentAmount: 250, payer: { id: null, name: "Aetna" }, importedAt: "2026-05-21" }),
    ]);
    expect(result.bestId).toBe("p-exact");
    const headline = result.byId.get("p-exact")?.reason ?? "";
    expect(headline.length).toBeGreaterThan(0);
    expect(result.byId.get("p-exact")?.score).toBeGreaterThanOrEqual(PRESELECT_THRESHOLD - 200);
  });
});
