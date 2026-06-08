// File: lib/clearinghouse/pickClaimStatusAdapter.ts
//
// Adapter factory for the 276/277 claim-status flow. Selects the right
// transport based on `clearinghouse_connections.vendor`:
//   - "availity" → CAQH CORE Phase II SOAP via AvailityRealtimeAdapter
//     (`lib/clearinghouse/adapters/AvailityRealtimeAdapter.ts`)
//   - anything else → MockClearinghouseAdapter (deterministic stand-in
//     used by tests and the demo org).
//
// Mirrors `pickEligibilityAdapter` so the Payer Received "Check payer
// status" action and any future status worker stay vendor-symmetric
// with the eligibility path.

import { AvailityRealtimeAdapter } from "@/lib/clearinghouse/adapters/AvailityRealtimeAdapter";
import { MockClearinghouseAdapter } from "@/lib/clearinghouse/MockClearinghouseAdapter";
import type { ClearinghouseAdapter } from "@/lib/clearinghouse/ClearinghouseAdapter";

export function pickClaimStatusAdapter(connection: {
  vendor?: string | null;
}): ClearinghouseAdapter {
  const vendor = (connection.vendor ?? "mock").toLowerCase();
  if (vendor === "availity") {
    return new AvailityRealtimeAdapter();
  }
  return new MockClearinghouseAdapter();
}
