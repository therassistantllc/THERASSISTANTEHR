/**
 * Tests for ERA take-back auto-detection (Task #470).
 *
 * Validates that:
 *  - PLB segments are parsed off an 835 transaction (parser change).
 *  - PLB WO/FB/J1/72 with positive amounts seed a `payment_recoupments`
 *    row anchored on the prior posted ERA payment (matched by payer
 *    claim control number).
 *  - Negative-pay CLP (or CLP02=22) seeds a recoupment using the new
 *    batch's row as the offset.
 *  - Re-running detection on the same batch dedupes — never doubles.
 *  - A workqueue follow-up is opened and linked back to the recoupment.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { validateWritePayload } from "../postingEngine/__tests__/_schemaGuard";
import { parseEra835 } from "../era835Parser";
import { detectAndSeedTakebacks } from "../postingEngine/eraTakebackDetection";

const ORG = "org-1";

/**
 * Minimal in-memory supabase fake that mirrors the chains
 * detectAndSeedTakebacks exercises (select/insert/update with eq/neq/
 * is/order/limit/maybeSingle/single).
 */
function makeFakeSupabase(initial: Record<string, Array<Record<string, unknown>>> = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    era_claim_payments: initial.era_claim_payments ?? [],
    payment_recoupments: initial.payment_recoupments ?? [],
    workqueue_items: initial.workqueue_items ?? [],
    audit_logs: initial.audit_logs ?? [],
    organization_settings: initial.organization_settings ?? [],
    professional_claims: initial.professional_claims ?? [],
    canonical_claims: initial.canonical_claims ?? [],
    eligibility_results: initial.eligibility_results ?? [],
    payer_profiles: initial.payer_profiles ?? [],
  };

  function builder(tableName: string) {
    const ctx: {
      eq: Array<[string, unknown]>;
      neq: Array<[string, unknown]>;
      isNull: string[];
      order: { col: string; ascending: boolean } | null;
      limitN: number | null;
      mode: "select" | "insert" | "update" | null;
      insertPayload: Record<string, unknown> | Array<Record<string, unknown>> | null;
      updatePayload: Record<string, unknown> | null;
      single: boolean;
      maybe: boolean;
    } = {
      eq: [],
      neq: [],
      isNull: [],
      order: null,
      limitN: null,
      mode: null,
      insertPayload: null,
      updatePayload: null,
      single: false,
      maybe: false,
    };

    const exec = () => {
      let rows = tables[tableName] ?? [];
      rows = rows.filter((r) =>
        ctx.eq.every(([k, v]) => {
          if (v === null) return r[k] === null || r[k] === undefined;
          return r[k] === v;
        }),
      );
      rows = rows.filter((r) =>
        ctx.neq.every(([k, v]) => r[k] !== v),
      );
      rows = rows.filter((r) =>
        ctx.isNull.every((k) => r[k] === null || r[k] === undefined),
      );
      if (ctx.order) {
        const { col, ascending } = ctx.order;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (ctx.limitN != null) rows = rows.slice(0, ctx.limitN);
      return rows;
    };

    const thenable = {
      then(onFul: (v: { data: unknown; error: null }) => unknown) {
        if (ctx.mode === "insert") {
          const payloads = Array.isArray(ctx.insertPayload)
            ? ctx.insertPayload
            : ctx.insertPayload
              ? [ctx.insertPayload]
              : [];
          for (const p of payloads) validateWritePayload(tableName, p);
          const inserted = payloads.map((p) => ({
            ...p,
            id:
              p.id ??
              `${tableName}-${(tables[tableName].length + 1).toString().padStart(3, "0")}`,
          }));
          tables[tableName] = [...(tables[tableName] ?? []), ...inserted];
          const data = ctx.single || ctx.maybe ? inserted[0] ?? null : inserted;
          return Promise.resolve({ data, error: null }).then(onFul);
        }
        if (ctx.mode === "update") {
          if (ctx.updatePayload) validateWritePayload(tableName, ctx.updatePayload);
          const rows = exec();
          for (const r of rows) Object.assign(r, ctx.updatePayload);
          return Promise.resolve({ data: rows, error: null }).then(onFul);
        }
        const rows = exec();
        const data = ctx.single || ctx.maybe ? rows[0] ?? null : rows;
        return Promise.resolve({ data, error: null }).then(onFul);
      },
    };

    const chain: Record<string, unknown> = {
      select(_cols?: string) {
        if (ctx.mode === null) ctx.mode = "select";
        return chain;
      },
      insert(p: Record<string, unknown> | Array<Record<string, unknown>>) {
        ctx.mode = "insert";
        ctx.insertPayload = p;
        return chain;
      },
      update(p: Record<string, unknown>) {
        ctx.mode = "update";
        ctx.updatePayload = p;
        return chain;
      },
      eq(k: string, v: unknown) {
        ctx.eq.push([k, v]);
        return chain;
      },
      neq(k: string, v: unknown) {
        ctx.neq.push([k, v]);
        return chain;
      },
      is(k: string, _v: unknown) {
        ctx.isNull.push(k);
        return chain;
      },
      in(_k: string, _vs: unknown[]) {
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.order = { col, ascending: opts?.ascending ?? true };
        return chain;
      },
      limit(n: number) {
        ctx.limitN = n;
        return chain;
      },
      single() {
        ctx.single = true;
        return thenable;
      },
      maybeSingle() {
        ctx.maybe = true;
        return thenable;
      },
      then: thenable.then,
    };
    return chain;
  }

  return {
    tables,
    client: { from: (t: string) => builder(t) } as unknown as Parameters<
      typeof detectAndSeedTakebacks
    >[0],
  };
}

// ── parser ──────────────────────────────────────────────────────────────────

describe("parseEra835 PLB extraction", () => {
  it("parses PLB segments into providerAdjustments", () => {
    // Two pairs on one PLB: WO with ref PCN-OLD-1 (+$50.00 take-back),
    // FB no ref (+$10.00).
    const raw = [
      "ISA*00*          *00*          *ZZ*PAYER          *ZZ*RECEIVER       *260101*1200*^*00501*000000001*0*P*:~",
      "GS*HP*PAYER*RECEIVER*20260101*1200*1*X*005010X221A1~",
      "ST*835*0001~",
      "BPR*I*100.00*C*ACH*CCP*01*999*DA*123*9999999*1*01*999*DA*456*20260101~",
      "TRN*1*TRN-1*9999999~",
      "DTM*405*20260101~",
      "N1*PR*ACME PAYER*XV*P0001~",
      "N1*PE*PROVIDER*XX*1234567893~",
      "LX*1~",
      "CLP*PCN-NEW-1*1*100.00*60.00**MC*PAYERCCN-1*11*1~",
      "PLB*1234567893*20261231*WO>PCN-OLD-1*50.00*FB*10.00~",
      "SE*10*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("");

    const parsed = parseEra835(raw);
    assert.equal(parsed.providerAdjustments.length, 2);
    assert.deepEqual(parsed.providerAdjustments[0], {
      adjustmentReasonCode: "WO",
      referenceIdentifier: "PCN-OLD-1",
      amount: 50,
    });
    assert.equal(parsed.providerAdjustments[1].adjustmentReasonCode, "FB");
    assert.equal(parsed.providerAdjustments[1].amount, 10);
  });

  it("returns empty providerAdjustments when no PLB present", () => {
    const raw =
      "ISA*00*          *00*          *ZZ*PAYER          *ZZ*RECEIVER       *260101*1200*^*00501*000000001*0*P*:~" +
      "GS*HP*PAYER*RECEIVER*20260101*1200*1*X*005010X221A1~" +
      "ST*835*0001~" +
      "BPR*I*0*C*ACH*CCP*01*999*DA*123*9999999*1*01*999*DA*456*20260101~" +
      "TRN*1*TRN-1*9999999~" +
      "N1*PR*ACME*XV*P0001~" +
      "SE*5*0001~GE*1*1~IEA*1*000000001~";
    const parsed = parseEra835(raw);
    assert.equal(parsed.providerAdjustments.length, 0);
  });
});

// ── detection: PLB WO ───────────────────────────────────────────────────────

describe("detectAndSeedTakebacks", () => {
  const BATCH = "batch-new";
  const PRIOR_BATCH = "batch-prior";

  function basePriorPayment(overrides: Record<string, unknown> = {}) {
    return {
      id: "era-prior-1",
      organization_id: ORG,
      era_import_batch_id: PRIOR_BATCH,
      payer_claim_control_number: "PCN-OLD-1",
      clp01_claim_control_number: "PROV-OLD-1",
      clp04_payment_amount: 50,
      professional_claim_id: "claim-old",
      client_id: "client-old",
      archived_at: null,
      created_at: "2026-05-01T00:00:00Z",
      ...overrides,
    };
  }

  function baseNewPositive(overrides: Record<string, unknown> = {}) {
    return {
      id: "era-new-pos",
      organization_id: ORG,
      era_import_batch_id: BATCH,
      payer_claim_control_number: "PCN-NEW-1",
      clp01_claim_control_number: "PROV-NEW-1",
      clp04_payment_amount: 100,
      professional_claim_id: "claim-new",
      client_id: "client-new",
      archived_at: null,
      created_at: "2026-05-15T00:00:00Z",
      ...overrides,
    };
  }

  it("seeds a payment_recoupments row + workqueue item from a PLB WO take-back", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [basePriorPayment(), baseNewPositive()],
    });

    const result = await detectAndSeedTakebacks(fake.client, {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH",
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [],
        providerAdjustments: [
          { adjustmentReasonCode: "WO", referenceIdentifier: "PCN-OLD-1", amount: 50 },
        ],
        segmentCount: 1,
      },
    });

    assert.equal(result.recoupmentsCreated, 1);
    assert.equal(result.detected.length, 1);
    const d = result.detected[0];
    assert.equal(d.kind, "plb");
    assert.equal(d.amount, 50);
    assert.equal(d.reasonCode, "WO");
    assert.equal(d.sourceEraClaimPaymentId, "era-prior-1");
    // offset = the positive-pay row in the current batch
    assert.equal(d.offsetEraClaimPaymentId, "era-new-pos");
    assert.equal(d.deduped, false);

    const recoup = fake.tables.payment_recoupments[0];
    assert.equal(recoup.source_era_claim_payment_id, "era-prior-1");
    assert.equal(recoup.offset_era_claim_payment_id, "era-new-pos");
    assert.equal(recoup.amount, 50);
    assert.equal(recoup.reason_code, "WO");
    assert.equal(recoup.professional_claim_id, "claim-old");
    assert.equal(recoup.client_id, "client-old");
    // workqueue item created + linked back
    assert.ok(fake.tables.workqueue_items.length >= 1);
    assert.equal(recoup.workqueue_item_id, fake.tables.workqueue_items[0].id);
  });

  it("dedupes when the same take-back is detected twice for the same batch", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [basePriorPayment(), baseNewPositive()],
    });
    const args = {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH" as const,
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [],
        providerAdjustments: [
          { adjustmentReasonCode: "WO", referenceIdentifier: "PCN-OLD-1", amount: 50 },
        ],
        segmentCount: 1,
      },
    };
    const first = await detectAndSeedTakebacks(fake.client, args);
    assert.equal(first.recoupmentsCreated, 1);
    const second = await detectAndSeedTakebacks(fake.client, args);
    assert.equal(second.recoupmentsCreated, 0);
    assert.equal(second.detected[0].deduped, true);
    // payment_recoupments table didn't double
    assert.equal(fake.tables.payment_recoupments.length, 1);
  });

  it("seeds a recoupment from a negative-pay CLP reversal (CLP02=22)", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [basePriorPayment(), baseNewPositive()],
    });
    const result = await detectAndSeedTakebacks(fake.client, {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH",
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [
          {
            clp01ClaimControlNumber: "PROV-OLD-1",
            clp02ClaimStatusCode: "22",
            clp03TotalChargeAmount: 50,
            clp04PaymentAmount: -50,
            clp05PatientResponsibilityAmount: 0,
            clp06ClaimFilingIndicator: "MC",
            payerClaimControlNumber: "PCN-OLD-1",
            patientControlNumber: null,
            placeOfService: null,
            claimFrequencyCode: null,
            patientName: null,
            patientIdentifier: null,
            renderingProviderId: null,
            services: [],
            adjustments: [],
            rawSegments: [],
          } as unknown as never,
        ],
        providerAdjustments: [],
        segmentCount: 1,
      },
    });

    assert.equal(result.recoupmentsCreated, 1);
    const d = result.detected[0];
    assert.equal(d.kind, "clp_reversal");
    assert.equal(d.amount, 50);
    assert.equal(d.reasonCode, "22");
    assert.equal(d.sourceEraClaimPaymentId, "era-prior-1");
    assert.equal(d.offsetEraClaimPaymentId, "era-new-pos");
  });

  it("ignores non-recoupment PLB codes (e.g. IR interest)", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [basePriorPayment(), baseNewPositive()],
    });
    const result = await detectAndSeedTakebacks(fake.client, {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH",
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [],
        providerAdjustments: [
          { adjustmentReasonCode: "IR", referenceIdentifier: null, amount: 5 },
        ],
        segmentCount: 1,
      },
    });
    assert.equal(result.recoupmentsCreated, 0);
    assert.equal(result.detected.length, 0);
  });

  it("dedupes a negative-CLP take-back with NULL reason_code on replay", async () => {
    // Regression: a CLP04<0 reversal with NO CLP02 is a valid take-back
    // signal (the `clp04 < 0` rule fires on its own) but stores
    // reason_code = NULL. The dedupe lookup must compare IS NULL, not
    // = "", or replay creates a duplicate row.
    const fake = makeFakeSupabase({
      era_claim_payments: [basePriorPayment(), baseNewPositive()],
    });
    const args = {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH" as const,
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [
          {
            clp01ClaimControlNumber: "PROV-OLD-1",
            clp02ClaimStatusCode: null,
            clp03TotalChargeAmount: 50,
            clp04PaymentAmount: -50,
            clp05PatientResponsibilityAmount: 0,
            clp06ClaimFilingIndicator: "MC",
            payerClaimControlNumber: "PCN-OLD-1",
            patientControlNumber: null,
            placeOfService: null,
            claimFrequencyCode: null,
            patientName: null,
            patientIdentifier: null,
            renderingProviderId: null,
            services: [],
            adjustments: [],
            rawSegments: [],
          } as unknown as never,
        ],
        providerAdjustments: [],
        segmentCount: 1,
      },
    };
    const first = await detectAndSeedTakebacks(fake.client, args);
    assert.equal(first.recoupmentsCreated, 1);
    assert.equal(fake.tables.payment_recoupments[0].reason_code, null);
    const second = await detectAndSeedTakebacks(fake.client, args);
    assert.equal(second.recoupmentsCreated, 0);
    assert.equal(second.detected[0].deduped, true);
    assert.equal(fake.tables.payment_recoupments.length, 1);
  });

  it("surfaces a parse-time anomaly when no source ERA payment can be matched", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [baseNewPositive()],
    });
    const result = await detectAndSeedTakebacks(fake.client, {
      organizationId: ORG,
      eraImportBatchId: BATCH,
      parsed: {
        transactionSetControlNumber: "1",
        paymentAmount: 100,
        paymentMethod: "ACH",
        traceNumber: "TRN-1",
        paymentDate: "2026-05-15",
        payerName: "ACME",
        payerIdentifier: "P1",
        claims: [],
        providerAdjustments: [
          { adjustmentReasonCode: "WO", referenceIdentifier: "UNKNOWN-PCN", amount: 25 },
        ],
        segmentCount: 1,
      },
    });
    assert.equal(result.recoupmentsCreated, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /could not be matched/);
  });
});
