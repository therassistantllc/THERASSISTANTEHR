import { validateEligibility270Input } from "./validate270";
import type {
  Eligibility270Input,
  Generated270Request,
} from "./types";

// ---------------------------------------------------------------------------
// Availity X12 005010X279A1 (270) generator.
//
// Envelope per Availity Batch EDI Companion Guide v.20260429 — HARD-SET:
//   ISA08 = 030240928 (Availity Dun & Bradstreet number)   [not overridable]
//   GS01  = "HS"  (Eligibility, Coverage or Benefit Inquiry, 270)
//   GS03  = 030240928                                       [not overridable]
//   GS08  = 005010X279A1                                    [not overridable]
//   ISA15 = derived from connection.mode ("test"→"T", "production"→"P").
//           The legacy connection.isa_usage_indicator field is ignored for
//           routing — mode is the single source of truth — to prevent the
//           common misconfiguration of routing a test payload to production
//           or vice versa.
//
//   1000A NM1*41  Submitter Name and ID  (REQUIRED, before any HL loop)
//   1000B NM1*40  Receiver Name and ID   (REQUIRED, "AVAILITY" / 030240928)
//
// HL hierarchy per X12 270 TR3:
//   HL*1**20*1   — 2000A Information Source (the payer)
//     NM1*PR     — 2100A Information Source Name
//   HL*2*1*21*1  — 2000B Information Receiver (the provider doing the inquiry)
//     NM1*1P     — 2100B Information Receiver Name
//   HL*3*2*22*0  — 2000C Subscriber
//     TRN        — Trace number (assigning correlation back to 271)
//     NM1*IL     — 2100C Subscriber Name (member ID)
//     DMG        — Subscriber demographics (DOB / gender)
//     DTP*291    — Eligibility-as-of date (optional but recommended)
//     EQ         — One per requested service type code
//
// CAQH CORE Data Content Rule vEB.2.1 §1.3.2.3: an Explicit Inquiry sends
// any STC other than "30"; a Generic Inquiry sends only "30". This generator
// emits one EQ segment per item in serviceTypeCodes — caller decides the mix.
// ---------------------------------------------------------------------------

// Availity Batch EDI Companion Guide v.20260429 §6.2 — fixed Availity values.
const AVAILITY_DNB = "030240928";
const X12_270_VERSION = "005010X279A1";
const AVAILITY_RECEIVER_NAME = "AVAILITY";

const X12_SEGMENT_TERMINATOR = "~";
const X12_ELEMENT_SEPARATOR = "*";
const X12_COMPONENT_SEPARATOR = ":";
const X12_REPETITION_SEPARATOR = "^";

function padRight(value: string, length: number): string {
  if (value.length >= length) return value.slice(0, length);
  return value + " ".repeat(length - value.length);
}

function padLeft(value: string, length: number, char = "0"): string {
  if (value.length >= length) return value.slice(-length);
  return char.repeat(length - value.length) + value;
}

function sanitizeAlphanum(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^A-Z0-9 ]/gi, "").toUpperCase();
}

function sanitizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[*~:^]/g, " ")
    .trim()
    .toUpperCase();
}

function formatDateCCYYMMDD(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatDateYYMMDD(d: Date): string {
  return formatDateCCYYMMDD(d).slice(2);
}

function formatTimeHHMM(d: Date): string {
  const h = d.getUTCHours().toString().padStart(2, "0");
  const min = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}${min}`;
}

function normalizeDob(dob: string): string {
  // Accept CCYYMMDD or YYYY-MM-DD; emit CCYYMMDD.
  if (/^\d{8}$/.test(dob)) return dob;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) return dob.replace(/-/g, "");
  return dob;
}

function normalizeServiceDate(d: string | null | undefined): string {
  if (!d) return formatDateCCYYMMDD(new Date());
  return normalizeDob(d);
}

function newControlNumber(seedOffset = 0): string {
  // 9-digit numeric, derived from now + jitter. Non-monotonic across runs is
  // fine for individual real-time inquiries; batch callers should pass their
  // own monotonic sequence if uniqueness within an interchange matters.
  const base = (Date.now() + seedOffset) % 1_000_000_000;
  return padLeft(base.toString(), 9);
}

function newPayloadId(submitterId: string, traceId: string): string {
  return `AVAILITY-270-${sanitizeAlphanum(submitterId)}-${traceId}`;
}

function buildSegment(elements: Array<string | number | null | undefined>): string {
  const cleaned = elements.map((e) => (e === null || e === undefined ? "" : String(e)));
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();
  return cleaned.join(X12_ELEMENT_SEPARATOR) + X12_SEGMENT_TERMINATOR;
}

export function buildAvaility270(input: Eligibility270Input): Generated270Request {
  const validation = validateEligibility270Input(input);
  const now = new Date();
  const isaControlNumber = newControlNumber(0);
  const gsControlNumber = newControlNumber(1);
  const stControlNumber = padLeft(newControlNumber(2).slice(-4), 4);
  const traceId =
    input.traceId ?? `T${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 9_000) + 1_000}`;
  const payloadId = newPayloadId(input.connection.submitter_id, traceId);

  if (!validation.isValid) {
    return {
      transactionType: "270",
      notes: "Validation failed — no X12 emitted.",
      mode: input.connection.mode,
      payloadId,
      fileContent: "",
      isaControlNumber,
      gsControlNumber,
      stControlNumber,
      validation,
    };
  }

  const segments: string[] = [];

  // ISA — 16 elements, fixed widths.
  // ISA08 hard-set to Availity D&B; ISA15 derived directly from connection.mode.
  const isaUsageIndicator: "T" | "P" = input.connection.mode === "production" ? "P" : "T";
  const isa = [
    "ISA",
    "00",
    padRight("", 10),
    "00",
    padRight("", 10),
    input.connection.sender_qualifier ?? "ZZ",
    padRight(sanitizeAlphanum(input.connection.submitter_id), 15),
    input.connection.receiver_qualifier ?? "ZZ",
    padRight(AVAILITY_DNB, 15),
    formatDateYYMMDD(now),
    formatTimeHHMM(now),
    X12_REPETITION_SEPARATOR,
    "00501",
    isaControlNumber,
    "0",
    isaUsageIndicator,
    X12_COMPONENT_SEPARATOR,
  ];
  segments.push(isa.join(X12_ELEMENT_SEPARATOR) + X12_SEGMENT_TERMINATOR);

  // GS — GS03 hard-set to Availity D&B, GS08 hard-set to 005010X279A1.
  segments.push(
    buildSegment([
      "GS",
      "HS",
      sanitizeAlphanum(input.connection.submitter_id),
      AVAILITY_DNB,
      formatDateCCYYMMDD(now),
      formatTimeHHMM(now),
      gsControlNumber,
      "X",
      X12_270_VERSION,
    ]),
  );

  // ST
  segments.push(buildSegment(["ST", "270", stControlNumber, X12_270_VERSION]));

  // BHT — Beginning of Hierarchical Transaction
  segments.push(
    buildSegment([
      "BHT",
      "0022",
      "13",
      sanitizeAlphanum(traceId).slice(0, 30),
      formatDateCCYYMMDD(now),
      formatTimeHHMM(now),
    ]),
  );

  // Track ST-internal segment count (excludes ISA/GS/IEA/GE; INCLUDES ST and SE).
  // We'll count from ST onward, then append SE = count after we know the total.
  let stInternalCount = 2; // ST + BHT

  // Loop 1000A — Submitter Name (NM1*41) [REQUIRED before HL loops, per CG §6.3].
  // NM109 qualifier "46" = Electronic Transmitter Identification Number.
  segments.push(
    buildSegment([
      "NM1",
      "41",
      "2",
      sanitizeName(input.submitterName).slice(0, 60),
      "",
      "",
      "",
      "",
      "46",
      sanitizeAlphanum(input.connection.submitter_id),
    ]),
  );
  stInternalCount += 1;

  // Loop 1000A PER — Submitter EDI Contact Information (optional; emit only
  // if at least one contact channel is available; TR3 requires at least one
  // of TE/EM/FX when PER is present).
  const phone = input.connection.submitter_contact_phone?.replace(/[^0-9]/g, "");
  const email = input.connection.submitter_contact_email?.trim();
  if (phone || email) {
    const perElements: Array<string> = ["PER", "IC", sanitizeName(input.submitterName).slice(0, 60)];
    if (phone) {
      perElements.push("TE", phone);
    } else {
      perElements.push("", "");
    }
    if (email) {
      perElements.push("EM", email);
    }
    segments.push(buildSegment(perElements));
    stInternalCount += 1;
  }

  // Loop 1000B — Receiver Name (NM1*40) [REQUIRED]. Hard-set to AVAILITY /
  // Availity D&B per CG §6.3 — payers are addressed via the 2100A NM1*PR.
  segments.push(
    buildSegment([
      "NM1",
      "40",
      "2",
      AVAILITY_RECEIVER_NAME,
      "",
      "",
      "",
      "",
      "46",
      AVAILITY_DNB,
    ]),
  );
  stInternalCount += 1;

  // Loop 2000A — Information Source
  segments.push(buildSegment(["HL", "1", "", "20", "1"]));
  stInternalCount += 1;

  // Loop 2100A — Information Source Name
  segments.push(
    buildSegment([
      "NM1",
      "PR",
      "2",
      sanitizeName(input.informationSource.payerName).slice(0, 60),
      "",
      "",
      "",
      "",
      "PI",
      sanitizeAlphanum(input.informationSource.payerId),
    ]),
  );
  stInternalCount += 1;

  // Loop 2000B — Information Receiver (provider)
  segments.push(buildSegment(["HL", "2", "1", "21", "1"]));
  stInternalCount += 1;

  const recvEntity = input.informationReceiver.entityType;
  segments.push(
    buildSegment([
      "NM1",
      "1P",
      recvEntity,
      sanitizeName(input.informationReceiver.lastNameOrOrg).slice(0, 60),
      recvEntity === "1" ? sanitizeName(input.informationReceiver.firstName ?? "").slice(0, 35) : "",
      "",
      "",
      "",
      "XX",
      input.informationReceiver.npi,
    ]),
  );
  stInternalCount += 1;

  // Loop 2000C — Subscriber (HL03=22, HL04=0 because we are not including a dependent loop)
  segments.push(buildSegment(["HL", "3", "2", "22", "0"]));
  stInternalCount += 1;

  // 2100C TRN — Trace Number (echoed back in 271 for correlation)
  segments.push(
    buildSegment([
      "TRN",
      "1",
      sanitizeAlphanum(traceId).slice(0, 30),
      padLeft(sanitizeAlphanum(input.connection.submitter_id).slice(0, 10), 10),
    ]),
  );
  stInternalCount += 1;

  // 2100C NM1*IL — Subscriber Name + Member ID
  segments.push(
    buildSegment([
      "NM1",
      "IL",
      "1",
      sanitizeName(input.subscriber.lastName).slice(0, 60),
      sanitizeName(input.subscriber.firstName).slice(0, 35),
      sanitizeName(input.subscriber.middleName ?? "").slice(0, 25),
      "",
      "",
      "MI",
      sanitizeAlphanum(input.subscriber.memberId),
    ]),
  );
  stInternalCount += 1;

  // 2100C REF*1L — Group or Policy Number (optional but required by
  // many payers when the member's plan is identified by a Group #).
  const groupNumber = sanitizeAlphanum(input.subscriber.groupNumber ?? "");
  if (groupNumber) {
    segments.push(buildSegment(["REF", "1L", groupNumber]));
    stInternalCount += 1;
  }

  // 2100C DMG — Subscriber demographics
  const gender = input.subscriber.gender ?? "U";
  segments.push(buildSegment(["DMG", "D8", normalizeDob(input.subscriber.dob), gender]));
  stInternalCount += 1;

  // 2100C DTP*291 — Eligibility "as of" date
  segments.push(buildSegment(["DTP", "291", "D8", normalizeServiceDate(input.serviceDate)]));
  stInternalCount += 1;

  // 2110C EQ — one per service type code
  for (const stc of input.serviceTypeCodes) {
    segments.push(buildSegment(["EQ", sanitizeAlphanum(stc)]));
    stInternalCount += 1;
  }

  // SE — count = stInternalCount + 1 (SE itself)
  segments.push(buildSegment(["SE", String(stInternalCount + 1), stControlNumber]));

  // GE / IEA
  segments.push(buildSegment(["GE", "1", gsControlNumber]));
  segments.push(buildSegment(["IEA", "1", isaControlNumber]));

  const fileContent = segments.join("");

  return {
    transactionType: "270",
    notes:
      "Availity X12 005010X279A1 (270) — Companion Guide v.20260429 envelope (ISA08=030240928, GS01=HS, GS03=030240928).",
    mode: input.connection.mode,
    payloadId,
    fileContent,
    isaControlNumber,
    gsControlNumber,
    stControlNumber,
    validation,
  };
}
