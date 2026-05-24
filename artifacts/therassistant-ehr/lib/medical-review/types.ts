import type { MedicalReviewTab } from "./tabs";

export type MedicalReviewRequestType =
  | "records"
  | "treatment_plan"
  | "notes"
  | "medical_necessity";

export interface MedicalReviewRow {
  id: string;
  requestType: MedicalReviewRequestType;
  requestTypeLabel: string;
  primaryTab: MedicalReviewTab;
  tabs: MedicalReviewTab[];

  claimId: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerProfileId: string | null;
  payerName: string;

  appointmentId: string | null;
  encounterId: string | null;
  dateOfService: string | null;

  requestedDocuments: string[];
  requestSource: string | null;
  requestNotes: string | null;
  requestDate: string | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  isUrgent: boolean;
  isOverdue: boolean;

  chargeAmount: number;
  denialCode: string | null;
  claimStatus: string | null;

  providerId: string | null;
  practiceId: string | null;
  assignedTo: string | null;
  assignedToKind: "clinician" | "admin" | "biller" | null;
  assignedBillerId: string | null;
  followUpDueAt: string | null;

  submittedAt: string | null;
  lastActionAt: string | null;
}

export interface MedicalReviewFilters {
  practice?: string;
  clinician?: string;
  client?: string;
  payer?: string;
  dosFrom?: string;
  dosTo?: string;
  status?: string;
  priority?: string;
  minAmount?: string;
  maxAmount?: string;
  agingBucket?: string;
  assignedBiller?: string;
  carcRarc?: string;
  followUpDue?: string;
}
