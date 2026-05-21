export type Availity270Mode = "test" | "production";

export interface Availity270Connection {
  id?: string;
  organization_id: string;
  clearinghouse_name?: string;
  mode: Availity270Mode;
  submitter_id: string;
  submitter_name?: string | null;
  sender_qualifier: "30" | "ZZ";
  receiver_qualifier: "30" | "ZZ";
  receiver_id: string;
  receiver_name: string;
  gs_receiver_code: string;
  x12_version: string;
  isa_usage_indicator: "T" | "P";
  submitter_contact_phone?: string | null;
  submitter_contact_email?: string | null;
}

export interface Availity270InformationSource {
  payerName: string;
  payerId: string;
}

export interface Availity270InformationReceiver {
  entityType: "1" | "2";
  lastNameOrOrg: string;
  firstName?: string | null;
  npi: string;
}

export interface Availity270Subscriber {
  lastName: string;
  firstName: string;
  middleName?: string | null;
  memberId: string;
  dob: string;
  gender?: "M" | "F" | "U" | null;
}

export interface Eligibility270Input {
  connection: Availity270Connection;
  submitterName: string;
  informationSource: Availity270InformationSource;
  informationReceiver: Availity270InformationReceiver;
  subscriber: Availity270Subscriber;
  serviceTypeCodes: string[];
  serviceDate?: string | null;
  traceId?: string;
}

export interface Availity270ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
  loop?: string;
  segment?: string;
}

export interface Availity270ValidationResult {
  isValid: boolean;
  errors: Availity270ValidationError[];
  warnings: Availity270ValidationError[];
}

export interface Generated270Request {
  transactionType: "270";
  notes: string;
  mode: Availity270Mode;
  payloadId: string;
  fileContent: string;
  isaControlNumber: string;
  gsControlNumber: string;
  stControlNumber: string;
  validation: Availity270ValidationResult;
}

export interface ParsedAAAError {
  code: string;
  description: string;
  followUpAction?: string | null;
  loop?: string | null;
  rejectReason?: string | null;
}

export interface ParsedEB271 {
  eligibilityCode: string;
  eligibilityCodeMeaning: string;
  coverageLevelCode?: string | null;
  coverageLevelMeaning?: string | null;
  serviceTypeCode?: string | null;
  insuranceTypeCode?: string | null;
  planDescription?: string | null;
  timePeriodQualifier?: string | null;
  monetaryAmount?: number | null;
  percent?: number | null;
  quantityQualifier?: string | null;
  quantity?: number | null;
  inPlanNetwork?: "Y" | "N" | "W" | "U" | null;
  followingSegments?: string[][];
}

export interface Parsed271Response {
  status: "active" | "inactive" | "not_found" | "error" | "unknown";
  payerName?: string | null;
  payerId?: string | null;
  planName?: string | null;
  subscriberLastName?: string | null;
  subscriberFirstName?: string | null;
  memberId?: string | null;
  dob?: string | null;
  gender?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  aaaErrors: ParsedAAAError[];
  benefits: ParsedEB271[];
  messages: string[];
  isaControlNumber?: string | null;
  gsControlNumber?: string | null;
  stControlNumber?: string | null;
  rawSegments: string[][];
}
