export type ClinicalFormFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "checkbox";

export type ClinicalFormFieldOption = {
  label: string;
  value: number | string;
};

export type ClinicalFormField = {
  id?: string;
  position: number;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  kind: ClinicalFormFieldKind;
  required: boolean;
  options: ClinicalFormFieldOption[];
  scoringWeight: number;
};

export type ScoringBand = { min: number; max: number; label: string };

export type ScoringKind = "none" | "sum";

export type HighRiskRule =
  | { kind: "field_gte"; fieldKey: string; gte: number; reason: string }
  | { kind: "score_gte"; gte: number; reason: string };

export type ClinicalForm = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  description?: string | null;
  scoringKind: ScoringKind;
  scoringBands: ScoringBand[];
  highRiskRule: HighRiskRule | null;
  isBuiltin: boolean;
  isActive: boolean;
  fields: ClinicalFormField[];
};

export type ClinicalFormResponses = Record<string, string | number | boolean | null>;

export type ClinicalFormSubmission = {
  id: string;
  organizationId: string;
  formId: string;
  formCode: string;
  formTitle: string;
  encounterId: string | null;
  clientId: string;
  providerId: string | null;
  responses: ClinicalFormResponses;
  score: number | null;
  severity: string | null;
  highRisk: boolean;
  highRiskReason: string | null;
  status: "draft" | "submitted";
  submittedAt: string | null;
  createdAt: string;
};
