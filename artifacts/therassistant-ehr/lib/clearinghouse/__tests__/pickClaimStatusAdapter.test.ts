/**
 * Adapter-routing test for the Payer Received "Check payer status"
 * dispatcher (Task #446).
 *
 * Mirrors `pickEligibilityAdapter` — vendor='availity' must route to
 * the real AvailityRealtimeAdapter (CAQH CORE SOAP 276/277) and
 * everything else falls back to MockClearinghouseAdapter. The Payer
 * Received check_status flow defers to `pickClaimStatusAdapter` for
 * adapter selection, so this test is the source of truth that real
 * Availity connections actually transmit a real 276.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { pickClaimStatusAdapter } from "../pickClaimStatusAdapter";
import { AvailityRealtimeAdapter } from "../adapters/AvailityRealtimeAdapter";
import { MockClearinghouseAdapter } from "../MockClearinghouseAdapter";

describe("pickClaimStatusAdapter", () => {
  it("routes vendor='availity' to AvailityRealtimeAdapter", () => {
    const adapter = pickClaimStatusAdapter({ vendor: "availity" });
    assert.ok(
      adapter instanceof AvailityRealtimeAdapter,
      "vendor='availity' must select AvailityRealtimeAdapter, not the mock",
    );
  });

  it("is case-insensitive for the vendor string", () => {
    const adapter = pickClaimStatusAdapter({ vendor: "Availity" });
    assert.ok(adapter instanceof AvailityRealtimeAdapter);
  });

  it("falls back to MockClearinghouseAdapter for unknown / null vendor", () => {
    assert.ok(pickClaimStatusAdapter({ vendor: "mock" }) instanceof MockClearinghouseAdapter);
    assert.ok(pickClaimStatusAdapter({ vendor: null }) instanceof MockClearinghouseAdapter);
    assert.ok(pickClaimStatusAdapter({}) instanceof MockClearinghouseAdapter);
  });
});
