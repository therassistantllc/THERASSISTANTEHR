import { CORE_STC_BY_CODE, describeServiceTypeCode, isCoreServiceTypeCode } from "./coreServiceTypeCodes";
import type {
  Availity270ValidationError,
  Availity270ValidationResult,
  Eligibility270Input,
} from "./types";

const NPI_REGEX = /^\d{10}$/;
const DOB_REGEX = /^(\d{8}|\d{4}-\d{2}-\d{2})$/;

export function validateEligibility270Input(
  input: Eligibility270Input,
): Availity270ValidationResult {
  const errors: Availity270ValidationError[] = [];
  const warnings: Availity270ValidationError[] = [];

  // Envelope sanity. ISA15 / ISA08 / GS03 / GS08 are not validated here
  // because generate270.ts hard-sets them from connection.mode + Availity
  // companion-guide constants — no caller can produce a mismatched envelope.
  if (!input.connection?.submitter_id?.trim()) {
    errors.push({
      field: "connection.submitter_id",
      message: "Submitter ID is required (ISA06 / 1000A NM1*41 NM109).",
      severity: "error",
      loop: "ISA",
      segment: "ISA06",
    });
  }
  if (input.connection && !["test", "production"].includes(input.connection.mode)) {
    errors.push({
      field: "connection.mode",
      message: 'Connection mode must be "test" or "production"; ISA15 is derived from this value.',
      severity: "error",
      loop: "ISA",
      segment: "ISA15",
    });
  }
  if (!input.submitterName?.trim()) {
    errors.push({
      field: "submitterName",
      message: "Submitter name is required (1000A NM1*41 NM103).",
      severity: "error",
      loop: "1000A",
      segment: "NM103",
    });
  }

  // Information source (payer)
  if (!input.informationSource?.payerName?.trim()) {
    errors.push({
      field: "informationSource.payerName",
      message: "Payer name is required (2100A NM1*PR NM103).",
      severity: "error",
      loop: "2100A",
      segment: "NM103",
    });
  }
  if (!input.informationSource?.payerId?.trim()) {
    errors.push({
      field: "informationSource.payerId",
      message: "Payer ID is required (2100A NM1*PR NM109).",
      severity: "error",
      loop: "2100A",
      segment: "NM109",
    });
  }

  // Information receiver (provider)
  if (!input.informationReceiver?.lastNameOrOrg?.trim()) {
    errors.push({
      field: "informationReceiver.lastNameOrOrg",
      message:
        "Information receiver (provider) name is required (2100B NM1*1P NM103).",
      severity: "error",
      loop: "2100B",
      segment: "NM103",
    });
  }
  if (!NPI_REGEX.test(input.informationReceiver?.npi ?? "")) {
    errors.push({
      field: "informationReceiver.npi",
      message:
        "Information receiver NPI must be exactly 10 digits (2100B NM1*1P NM109 with XX qualifier).",
      severity: "error",
      loop: "2100B",
      segment: "NM109",
    });
  }
  if (
    input.informationReceiver?.entityType === "1" &&
    !input.informationReceiver?.firstName?.trim()
  ) {
    warnings.push({
      field: "informationReceiver.firstName",
      message:
        "Information receiver first name should be supplied for individual (entityType=1) providers.",
      severity: "warning",
      loop: "2100B",
      segment: "NM104",
    });
  }

  // Subscriber
  if (!input.subscriber?.lastName?.trim()) {
    errors.push({
      field: "subscriber.lastName",
      message: "Subscriber last name is required (2100C NM1*IL NM103).",
      severity: "error",
      loop: "2100C",
      segment: "NM103",
    });
  }
  if (!input.subscriber?.memberId?.trim()) {
    errors.push({
      field: "subscriber.memberId",
      message: "Subscriber member ID is required (2100C NM1*IL NM109 with MI qualifier).",
      severity: "error",
      loop: "2100C",
      segment: "NM109",
    });
  }
  if (!DOB_REGEX.test(input.subscriber?.dob ?? "")) {
    errors.push({
      field: "subscriber.dob",
      message:
        "Subscriber DOB is required and must be CCYYMMDD or YYYY-MM-DD (2100C DMG02).",
      severity: "error",
      loop: "2100C",
      segment: "DMG02",
    });
  }

  // Service type codes (EQ)
  if (!input.serviceTypeCodes || input.serviceTypeCodes.length === 0) {
    errors.push({
      field: "serviceTypeCodes",
      message:
        'At least one service type code is required (2110C EQ01). Use "30" for a Generic Inquiry per CAQH CORE.',
      severity: "error",
      loop: "2110C",
      segment: "EQ01",
    });
  } else {
    // CAQH CORE Data Content Rule vEB.2.1 Appendix Table 1: warn (not error)
    // when a request includes an STC outside the CORE-required set.
    // Payers may accept non-CORE codes, but they have no CORE-mandated
    // obligation to return the structured response shape (financial
    // responsibility / remaining-coverage benefits / etc.) for them.
    for (const stc of input.serviceTypeCodes) {
      const upper = (stc ?? "").toUpperCase();
      if (!isCoreServiceTypeCode(upper)) {
        warnings.push({
          field: "serviceTypeCodes",
          message: `Service type code "${stc}" is not in the CAQH CORE Required STC set (vEB.2.1 Appendix Table 1). The payer is under no CORE-mandated obligation to return structured benefits for it — expect generic eligibility only or, worst case, a rejection.`,
          severity: "warning",
          loop: "2110C",
          segment: "EQ01",
        });
      } else {
        const meta = CORE_STC_BY_CODE.get(upper);
        if (meta && !meta.generic && !meta.explicit) {
          warnings.push({
            field: "serviceTypeCodes",
            message: `Service type code "${stc}" (${describeServiceTypeCode(upper)}) is a CORE-recognized code but neither Generic nor Explicit Inquiry — verify the payer supports it.`,
            severity: "warning",
            loop: "2110C",
            segment: "EQ01",
          });
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
