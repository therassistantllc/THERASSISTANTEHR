export type MedicalReviewTab =
  | "records_requested"
  | "treatment_plan_requested"
  | "notes_requested"
  | "medical_necessity_review"
  | "deadline_approaching";

export const MEDICAL_REVIEW_TABS: Array<{ id: MedicalReviewTab; label: string }> = [
  { id: "records_requested", label: "Records Requested" },
  { id: "treatment_plan_requested", label: "Treatment Plan Requested" },
  { id: "notes_requested", label: "Notes Requested" },
  { id: "medical_necessity_review", label: "Medical Necessity Review" },
  { id: "deadline_approaching", label: "Deadline Approaching" },
];
