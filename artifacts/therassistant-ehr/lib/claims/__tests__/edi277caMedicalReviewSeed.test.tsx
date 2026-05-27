// Tests for the 277CA → Medical Review queue auto-seeding pipeline.
//
//   - detect277CADocumentationRequest classifies STC codes correctly.
//   - writeMedicalReviewRequestAudit is idempotent on (claim, origin,
//     sourceObjectId) — replaying the same ack does not duplicate rows.
//   - Pure ack with non-documentation status codes does NOT seed.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  detect277CADocumentationRequest,
  writeMedicalReviewRequestAudit,
} from "@/lib/medical-review/documentationRequestDetection";

type Row = Record<string, unknown>;

function makeFakeSupabase(initialAuditRows: Row[] = []) {
  const rows: Row[] = [...initialAuditRows];
  const builder = (filters: Record<string, unknown>) => {
    return {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return this;
      },
      limit(_n: number) {
        return this;
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        const matched = rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        );
        return Promise.resolve({ data: matched, error: null }).then(resolve);
      },
    };
  };
  return {
    inserted: rows,
    from(table: string) {
      assert.equal(table, "audit_logs");
      return {
        select(_cols: string) {
          return builder({});
        },
        insert(payload: Row) {
          rows.push({ ...payload, id: `audit-${rows.length + 1}` });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("detect277CADocumentationRequest", () => {
  it("returns a request when STC carries A6 + status 287", () => {
    const detected = detect277CADocumentationRequest({
      stcStatuses: [
        { category: "A6", status: "287", entity: "PR" },
      ],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "records");
    assert.deepEqual(detected!.requestedDocuments, ["Medical records"]);
    assert.match(detected!.requestSource, /277CA STC A6:287/);
    assert.ok(detected!.triggerCodes.includes("A6:287"));
  });

  it("returns a request when STC status is 324 (need additional documentation)", () => {
    const detected = detect277CADocumentationRequest({
      stcStatuses: [
        { category: "A3", status: "324", entity: "PR" },
      ],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "records");
  });

  it("returns null for a plain accepted ack (A1/A2)", () => {
    const detected = detect277CADocumentationRequest({
      stcStatuses: [
        { category: "A2", status: "20", entity: "PR" },
      ],
    });
    assert.equal(detected, null);
  });

  it("returns null for a rejected ack with no doc-request status code", () => {
    const detected = detect277CADocumentationRequest({
      stcStatuses: [
        { category: "A7", status: "562", entity: "PR" },
      ],
    });
    assert.equal(detected, null);
  });
});

describe("writeMedicalReviewRequestAudit", () => {
  it("inserts an audit row on first call", async () => {
    const sb = makeFakeSupabase();
    const result = await writeMedicalReviewRequestAudit(
      sb as unknown as Parameters<typeof writeMedicalReviewRequestAudit>[0],
      {
        organizationId: "org-1",
        claimId: "claim-1",
        clientId: "client-1",
        detected: {
          requestType: "records",
          requestedDocuments: ["Medical records"],
          requestSource: "277CA STC A6:287",
          notes: "test",
          triggerCodes: ["A6:287"],
        },
        origin: "277CA",
        sourceObjectId: "ack-1",
      },
    );
    assert.equal(result.status, "inserted");
    assert.equal(sb.inserted.length, 1);
    const row = sb.inserted[0];
    assert.equal(row.action, "medical_review_requested");
    assert.equal(row.claim_id, "claim-1");
    const meta = row.event_metadata as Record<string, unknown>;
    assert.equal(meta.requestType, "records");
    assert.equal(meta.origin, "277CA");
    assert.equal(meta.sourceObjectId, "ack-1");
  });

  it("skips when an audit row with the same origin + source already exists", async () => {
    const sb = makeFakeSupabase([
      {
        organization_id: "org-1",
        action: "medical_review_requested",
        claim_id: "claim-1",
        event_metadata: { origin: "277CA", sourceObjectId: "ack-1", triggerCodes: ["A6:287"] },
      },
    ]);
    const result = await writeMedicalReviewRequestAudit(
      sb as unknown as Parameters<typeof writeMedicalReviewRequestAudit>[0],
      {
        organizationId: "org-1",
        claimId: "claim-1",
        clientId: null,
        detected: {
          requestType: "records",
          requestedDocuments: ["Medical records"],
          requestSource: "277CA STC A6:287",
          notes: "test",
          triggerCodes: ["A6:287"],
        },
        origin: "277CA",
        sourceObjectId: "ack-1",
      },
    );
    assert.equal(result.status, "skipped");
    // Pre-seeded row is still the only one.
    assert.equal(sb.inserted.length, 1);
  });

  it("inserts again when origin matches but sourceObjectId differs (new ack)", async () => {
    const sb = makeFakeSupabase([
      {
        organization_id: "org-1",
        action: "medical_review_requested",
        claim_id: "claim-1",
        event_metadata: { origin: "277CA", sourceObjectId: "ack-1", triggerCodes: ["A6:287"] },
      },
    ]);
    const result = await writeMedicalReviewRequestAudit(
      sb as unknown as Parameters<typeof writeMedicalReviewRequestAudit>[0],
      {
        organizationId: "org-1",
        claimId: "claim-1",
        clientId: null,
        detected: {
          requestType: "records",
          requestedDocuments: ["Medical records"],
          requestSource: "277CA STC A6:287",
          notes: "test",
          triggerCodes: ["A6:287"],
        },
        origin: "277CA",
        sourceObjectId: "ack-2",
      },
    );
    assert.equal(result.status, "inserted");
    assert.equal(sb.inserted.length, 2);
  });
});
