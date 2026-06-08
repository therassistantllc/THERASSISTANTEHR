/**
 * Shared mapping for the Transmission Failures workqueue.
 *
 * Classifies a failed 837P batch transmission into one of five tabs from
 * the spec by inspecting the persisted submission outcome columns on
 * `claim_837p_batches` (last_submission_endpoint, last_submission_http_status,
 * submission_error). The same classifier powers the queue's list endpoint
 * and the detail panel so they never disagree.
 */

export type TransmissionFailureTabId =
  | "office_ally_failure"
  | "api_failure"
  | "sftp_failure"
  | "malformed_batch"
  | "connection_timeout";

export const TRANSMISSION_FAILURE_TABS: Array<{
  id: TransmissionFailureTabId;
  label: string;
}> = [
  { id: "office_ally_failure", label: "Office Ally Failure" },
  { id: "api_failure", label: "API Failure" },
  { id: "sftp_failure", label: "SFTP Failure" },
  { id: "malformed_batch", label: "Malformed Batch" },
  { id: "connection_timeout", label: "Connection Timeout" },
];

export const TRANSMISSION_FAILURE_TAB_IDS: TransmissionFailureTabId[] =
  TRANSMISSION_FAILURE_TABS.map((t) => t.id);

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed[\s_-]?out/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /eai_again/i,
  /socket hang up/i,
  /network/i,
  /fetch failed/i,
];

const MALFORMED_PATTERNS = [
  /malformed/i,
  /invalid x12/i,
  /parse/i,
  /schema/i,
  /isa\d+/i,
  /gs\d+/i,
  /se\d+/i,
  /\bsegment\b/i,
  /unbalanced/i,
  /bad envelope/i,
  /unexpected character/i,
];

const SFTP_PATTERNS = [/sftp/i, /ssh/i, /scp/i];

const OFFICE_ALLY_PATTERNS = [/office.?ally/i, /\boa[-_]/i, /availity/i];

export interface ClassifyInput {
  submissionError: string | null;
  lastSubmissionEndpoint: string | null;
  lastSubmissionHttpStatus: number | null;
}

/**
 * Resolve a failed batch to one of the five tabs. Precedence:
 *   1. Timeout/network signatures → "connection_timeout".
 *   2. Malformed-content signatures (parse/X12/schema) or 400/422 → "malformed_batch".
 *   3. Endpoint/message mentioning SFTP → "sftp_failure".
 *   4. Endpoint/message mentioning Office Ally or Availity → "office_ally_failure".
 *   5. Anything else with an HTTP status or generic API error → "api_failure".
 *
 * A row that doesn't match any signature still classifies as "api_failure"
 * so it remains visible in the queue and surfaces to a biller for triage.
 */
export function classifyTransmissionFailure(
  input: ClassifyInput,
): TransmissionFailureTabId {
  const msg = input.submissionError ?? "";
  const endpoint = input.lastSubmissionEndpoint ?? "";
  const status = input.lastSubmissionHttpStatus;
  const haystack = `${msg} ${endpoint}`.trim();

  if (TIMEOUT_PATTERNS.some((re) => re.test(haystack))) {
    return "connection_timeout";
  }
  if (
    MALFORMED_PATTERNS.some((re) => re.test(haystack)) ||
    status === 400 ||
    status === 422
  ) {
    return "malformed_batch";
  }
  if (SFTP_PATTERNS.some((re) => re.test(haystack))) {
    return "sftp_failure";
  }
  if (OFFICE_ALLY_PATTERNS.some((re) => re.test(haystack))) {
    return "office_ally_failure";
  }
  return "api_failure";
}

export function describeFailureTab(tab: TransmissionFailureTabId): string {
  switch (tab) {
    case "office_ally_failure":
      return "Office Ally / clearinghouse returned an error";
    case "api_failure":
      return "Clearinghouse API call failed";
    case "sftp_failure":
      return "SFTP transport failure";
    case "malformed_batch":
      return "Batch content was rejected as malformed";
    case "connection_timeout":
      return "Network connection timed out";
  }
}
