// Tests for the dependent routing layer that sits on top of the CAQH
// CORE Single Patient Attribution decision (vEB.1.0 §4.2–§4.3). The
// helper is pure: it takes an injectable lookup function so we can
// exercise routing without a live Supabase.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AttributionDecision } from "../../edi/availity270/attribution";
import { resolveAttributionRouting } from "../attributionRouting";

const subscriberDecision: AttributionDecision = {
  target: "subscriber",
  matchesRequestedPatient: true,
  mismatchReasons: [],
  attributedName: "Jane Doe",
};

const dependentMatchDecision: AttributionDecision = {
  target: "dependent",
  matchesRequestedPatient: true,
  mismatchReasons: [],
  attributedName: "Sam Doe",
};

const dependentMismatchDecision: AttributionDecision = {
  target: "dependent",
  matchesRequestedPatient: false,
  mismatchReasons: ["name_mismatch", "dob_mismatch"],
  attributedName: "Sam Doe",
};

describe("resolveAttributionRouting", () => {
  it("keeps subscriber-target responses on the requested patient", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: subscriberDecision,
      parsedDependent: null,
      lookup: async () => {
        throw new Error("lookup should not be invoked for subscriber target");
      },
    });
    assert.equal(routing.routedClientId, "patient-1");
    assert.equal(routing.routedToRequestedPatient, true);
    assert.equal(routing.unresolved, false);
  });

  it("keeps dependent-matches-requested-patient on the requested patient (already on dependent's chart)", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: dependentMatchDecision,
      parsedDependent: { firstName: "Sam", lastName: "Doe", dob: "2015-06-01" },
      lookup: async () => {
        throw new Error("lookup should not be invoked when decision matches requested patient");
      },
    });
    assert.equal(routing.routedClientId, "patient-1");
    assert.equal(routing.routedToRequestedPatient, true);
    assert.equal(routing.unresolved, false);
  });

  it("reroutes to the dependent's chart when exactly one match exists", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: dependentMismatchDecision,
      parsedDependent: { firstName: "Sam", lastName: "Doe", dob: "2015-06-01" },
      lookup: async () => ["dependent-99"],
    });
    assert.equal(routing.routedClientId, "dependent-99");
    assert.equal(routing.routedToRequestedPatient, false);
    assert.equal(routing.unresolved, false);
    assert.deepEqual(routing.candidateIds, ["dependent-99"]);
  });

  it("keeps the requested patient and flags ambiguous when multiple dependent candidates match", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: dependentMismatchDecision,
      parsedDependent: { firstName: "Sam", lastName: "Doe", dob: "2015-06-01" },
      lookup: async () => ["dep-a", "dep-b"],
    });
    assert.equal(routing.routedClientId, "patient-1");
    assert.equal(routing.unresolved, true);
    assert.equal(routing.unresolvedReason, "ambiguous_dependent_match");
    assert.deepEqual(routing.candidateIds, ["dep-a", "dep-b"]);
  });

  it("keeps the requested patient and flags no_dependent_match when lookup returns empty", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: dependentMismatchDecision,
      parsedDependent: { firstName: "Sam", lastName: "Doe", dob: "2015-06-01" },
      lookup: async () => [],
    });
    assert.equal(routing.routedClientId, "patient-1");
    assert.equal(routing.unresolved, true);
    assert.equal(routing.unresolvedReason, "no_dependent_match");
  });

  it("flags missing_dependent_identity when parsed dependent has no lastName or dob", async () => {
    const routing = await resolveAttributionRouting({
      requestedClientId: "patient-1",
      organizationId: "org-1",
      decision: dependentMismatchDecision,
      parsedDependent: { firstName: null, lastName: null, dob: null },
      lookup: async () => {
        throw new Error("lookup should be short-circuited when identity is missing");
      },
    });
    assert.equal(routing.routedClientId, "patient-1");
    assert.equal(routing.unresolved, true);
    assert.equal(routing.unresolvedReason, "missing_dependent_identity");
  });
});
