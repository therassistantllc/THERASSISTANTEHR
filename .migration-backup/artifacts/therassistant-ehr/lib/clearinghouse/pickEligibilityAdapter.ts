// File: lib/clearinghouse/pickEligibilityAdapter.ts
//
// Adapter factory for the eligibility 270/271 flow. Selects the right
// transport based on `clearinghouse_connections.vendor`:
//   - "availity" → CORE Phase II SOAP+WSDL via AvailityRealtimeAdapter
//     (`lib/clearinghouse/adapters/AvailityRealtimeAdapter.ts`,
//     gateway.availity.com:2021/core)
//   - anything else → MockClearinghouseAdapter (deterministic
//     stand-in used by tests and the demo org).
//
// All adapters expose `runEligibilityCORE(input: Eligibility270Input)`
// returning a shape compatible with the persistence flow in
// `ClearinghouseService.runEligibility`. We intentionally use a
// structural type here (instead of importing the full
// `ClearinghouseAdapter` interface) so this factory can be consumed
// without pulling in the legacy `runEligibility270`/`runClaimStatus276`
// methods that are still being phased out.

import { AvailityRealtimeAdapter } from "@/lib/clearinghouse/adapters/AvailityRealtimeAdapter";
import { MockClearinghouseAdapter } from "@/lib/clearinghouse/MockClearinghouseAdapter";
import type { Eligibility270Input, Parsed271Response } from "@/lib/edi/availity270/types";
import type { EligibilityResponseNormalized } from "@/types/clearinghouse";

export interface CoreEligibilityRunResult {
  rawRequest: string;
  rawResponse: string;
  normalized: EligibilityResponseNormalized;
  controlNumber: string;
  correlationId: string;
  parsed?: Parsed271Response;
  payloadId?: string;
}

export interface CoreEligibilityAdapter {
  readonly vendor: string;
  runEligibilityCORE(input: Eligibility270Input): Promise<CoreEligibilityRunResult>;
}

export function pickEligibilityAdapter(connection: {
  vendor?: string | null;
}): CoreEligibilityAdapter {
  const vendor = (connection.vendor ?? "mock").toLowerCase();
  if (vendor === "availity") {
    return new AvailityRealtimeAdapter();
  }
  return new MockClearinghouseAdapter();
}
