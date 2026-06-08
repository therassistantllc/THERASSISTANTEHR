// Client-safe types + constants for provider enrollment issues. Kept out of
// `providerEnrollmentIssuesService.ts` (which imports "server-only") so that
// client components can reference these without dragging the server module
// into the bundle.

export type ProviderEnrollmentIssueType =
  | "provider_not_enrolled"
  | "billing_npi_issue"
  | "rendering_npi_issue"
  | "taxonomy_issue"
  | "location_issue"
  | "group_linkage_issue";

export const PROVIDER_ENROLLMENT_ISSUE_TABS: Array<{
  id: ProviderEnrollmentIssueType;
  label: string;
}> = [
  { id: "provider_not_enrolled", label: "Provider Not Enrolled" },
  { id: "billing_npi_issue", label: "Billing NPI Issue" },
  { id: "rendering_npi_issue", label: "Rendering NPI Issue" },
  { id: "taxonomy_issue", label: "Taxonomy Issue" },
  { id: "location_issue", label: "Location Issue" },
  { id: "group_linkage_issue", label: "Group Linkage Issue" },
];

export interface ProviderEnrollmentIssueRow {
  id: string;
  claimId: string;
  claimNumber: string | null;
  claimStatus: string | null;
  organizationId: string;
  appointmentId: string | null;

  clientId: string | null;
  clientName: string;

  payerId: string | null;
  payerProfileId: string | null;
  payerName: string;

  providerId: string | null;
  practiceId: string | null;
  clinicianName: string;
  providerNpi: string | null;
  taxonomyCode: string | null;

  billingNpi: string | null;
  renderingNpi: string | null;
  serviceFacilitySameAsBilling: boolean;
  serviceFacilityName: string | null;
  serviceFacilityNpi: string | null;

  dateOfService: string | null;
  chargeAmount: number;

  issueType: ProviderEnrollmentIssueType;
  issueLabel: string;

  enrollmentStatus: string;
  enrollmentReference: string | null;
  enrollmentApprovedAt: string | null;
  enrollmentEnvironment: string | null;
  enrollmentExpiresAt: string | null;
  enrollmentNotes: string | null;

  holdNote: string | null;
  assignedTo: string | null;
  assignedToKind: "credentialing" | "biller" | null;
  assignedBillerId: string | null;
  followUpDueAt: string | null;
  denialCode: string | null;
  credentialingNote: string | null;
}
