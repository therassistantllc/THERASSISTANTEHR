/**
 * Shared types and constants for the Payer-Received module.
 * This file intentionally has NO `server-only` import so Client Components
 * can import the tab list and row types without pulling in server-side DB code.
 */

export type PayerReceivedTab =
  | "received"
  | "in_process"
  | "pending_review"
  | "approaching_follow_up";

export const PAYER_RECEIVED_TABS: Array<{ id: PayerReceivedTab; label: string }> = [
  { id: "received", label: "Received" },
  { id: "in_process", label: "In Process" },
  { id: "pending_review", label: "Pending Review" },
  { id: "approaching_follow_up", label: "Approaching Follow-Up" },
];

export interface StatusHistoryEntry {
  source: string;
  status: string;
  message: string | null;
  payerReferenceId: string | null;
  at: string;
  /**
   * For 276/277 inquiry rows: whether the inquiry was kicked off by a
   * biller clicking "Check payer status" (`manual`) or by the scheduled
   * auto-check cron (`auto`). `null` for non-inquiry events. Task #540.
   */
  triggerSource?: "manual" | "auto" | null;
}

export interface PayerReceivedRow {
  id: string;
  claimId: string;
  claimNumber: string;
  clientId: string;
  clientName: string;
  payerName: string;
  payerProfileId: string | null;
  dateOfService: string | null;
  payerReceivedAt: string | null;
  payerStatus: string;
  payerStatusCode: string | null;
  payerStatusText: string | null;
  daysInProcess: number;
  chargeAmount: number;
  expectedAdjudicationAt: string | null;
  submittedAt: string | null;
  slaDays: number;
  overdue: boolean;
  daysOverdue: number;
  // Tab classification
  tab: PayerReceivedTab;
  // Detail panel
  payerClaimNumber: string | null;
  statusHistory: StatusHistoryEntry[];
  submissionTrace: {
    submittedAt: string | null;
    acknowledgedAt: string | null;
    clearinghouseReference: string | null;
    payerClaimReference: string | null;
    submissionSequence: number | null;
    submissionStatus: string | null;
  };
  followUpNotes: Array<{ id: string; at: string; summary: string; userId: string | null }>;
  // Filter fields
  providerId: string | null;
  practiceId: string | null;
  assignedBillerId: string | null;
  followUpDueAt: string | null;
  movedToAgingAt: string | null;
  billingNotes: string | null;
  denialCode: string | null;
  /**
   * Latest ERA's parsed CARC / RARC / remark codes for this claim (Task
   * #561). Populated from `era_claim_payments.carc_codes` /
   * `rarc_codes` / `remark_codes` so the detail panel doesn't have to
   * re-parse `raw_segments` on every read. Empty when no ERA has landed
   * yet.
   */
  carcCodes: string[];
  rarcCodes: string[];
  remarkCodes: string[];
}

export interface PayerReceivedFilters {
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
  overdue?: string;
}
