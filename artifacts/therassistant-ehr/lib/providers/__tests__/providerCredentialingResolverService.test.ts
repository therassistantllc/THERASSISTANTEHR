import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePracticeAddress } from "../providerCredentialingResolverService";

const practiceAddressSource = "provider_credentialing_profiles.practice_address" as const;
const practiceAddressColumns = ["practice_address"];

test("parsePracticeAddress extracts city from comma-delimited credentialing address", () => {
  assert.deepEqual(parsePracticeAddress("500 Practice Way, Austin, TX 78701"), {
    address1: "500 Practice Way",
    address2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
    source: practiceAddressSource,
    columnsRead: practiceAddressColumns,
  });
});

test("parsePracticeAddress extracts city from un-delimited credentialing address", () => {
  assert.deepEqual(parsePracticeAddress("500 Practice Way Austin TX 78701"), {
    address1: "500 Practice Way",
    address2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
    source: practiceAddressSource,
    columnsRead: practiceAddressColumns,
  });
});

test("parsePracticeAddress preserves ZIP+4 and unit details in no-comma Colorado addresses", () => {
  assert.deepEqual(parsePracticeAddress("1556 N. Williams St. Unit 101 Denver, CO 80218-1661"), {
    address1: "1556 N. Williams St. Unit 101",
    address2: null,
    city: "Denver",
    state: "CO",
    zip: "80218-1661",
    source: practiceAddressSource,
    columnsRead: practiceAddressColumns,
  });
});

test("parsePracticeAddress handles unit addresses with a city comma", () => {
  assert.deepEqual(parsePracticeAddress("1556 N. Williams St Unit 101, Denver, CO 80218"), {
    address1: "1556 N. Williams St Unit 101",
    address2: null,
    city: "Denver",
    state: "CO",
    zip: "80218",
    source: practiceAddressSource,
    columnsRead: practiceAddressColumns,
  });
});

test("parsePracticeAddress handles apartment addresses without commas", () => {
  assert.deepEqual(parsePracticeAddress("1139 York St Apt 306 Denver CO 80206"), {
    address1: "1139 York St Apt 306",
    address2: null,
    city: "Denver",
    state: "CO",
    zip: "80206",
    source: practiceAddressSource,
    columnsRead: practiceAddressColumns,
  });
});
