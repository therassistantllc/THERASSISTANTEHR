import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePracticeAddress } from "../providerCredentialingResolverService";

test("parsePracticeAddress extracts city from comma-delimited credentialing address", () => {
  assert.deepEqual(parsePracticeAddress("500 Practice Way, Austin, TX 78701"), {
    address1: "500 Practice Way",
    address2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
    source: "provider_credentialing_profiles.practice_address",
  });
});

test("parsePracticeAddress extracts city from un-delimited credentialing address", () => {
  assert.deepEqual(parsePracticeAddress("500 Practice Way Austin TX 78701"), {
    address1: "500 Practice Way",
    address2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
    source: "provider_credentialing_profiles.practice_address",
  });
});
