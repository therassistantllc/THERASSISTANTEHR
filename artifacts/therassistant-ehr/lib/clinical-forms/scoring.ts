import type {
  ClinicalForm,
  ClinicalFormResponses,
  HighRiskRule,
  ScoringBand,
} from "./types";

export type ScoringResult = {
  score: number | null;
  severity: string | null;
  highRisk: boolean;
  highRiskReason: string | null;
};

function numericResponse(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function severityFromBands(score: number | null, bands: ScoringBand[]): string | null {
  if (score === null) return null;
  for (const band of bands) {
    if (score >= band.min && score <= band.max) return band.label;
  }
  return null;
}

function evaluateHighRisk(
  rule: HighRiskRule | null,
  responses: ClinicalFormResponses,
  score: number | null,
): { highRisk: boolean; reason: string | null } {
  if (!rule) return { highRisk: false, reason: null };
  if (rule.kind === "field_gte") {
    const v = numericResponse(responses[rule.fieldKey]);
    if (v !== null && v >= rule.gte) return { highRisk: true, reason: rule.reason };
    return { highRisk: false, reason: null };
  }
  if (rule.kind === "score_gte") {
    if (score !== null && score >= rule.gte) return { highRisk: true, reason: rule.reason };
    return { highRisk: false, reason: null };
  }
  return { highRisk: false, reason: null };
}

/**
 * Compute score, severity band, and high-risk flag for a submission.
 * Supports scoringKind:
 *   - "none": no scoring
 *   - "sum":  Σ (numeric response × field.scoringWeight) for radio/select/number fields
 */
export function scoreSubmission(form: ClinicalForm, responses: ClinicalFormResponses): ScoringResult {
  let score: number | null = null;

  if (form.scoringKind === "sum") {
    let total = 0;
    let anyNumeric = false;
    for (const field of form.fields) {
      if (!["radio", "select", "number"].includes(field.kind)) continue;
      const v = numericResponse(responses[field.fieldKey]);
      if (v === null) continue;
      total += v * (field.scoringWeight ?? 1);
      anyNumeric = true;
    }
    score = anyNumeric ? Math.round(total * 1000) / 1000 : null;
  }

  const severity = severityFromBands(score, form.scoringBands);
  const risk = evaluateHighRisk(form.highRiskRule, responses, score);
  return { score, severity, highRisk: risk.highRisk, highRiskReason: risk.reason };
}

/**
 * Validate responses against the form definition. Returns a list of human
 * error messages keyed by fieldKey, or an empty record if valid.
 */
export function validateResponses(
  form: ClinicalForm,
  responses: ClinicalFormResponses,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const raw = responses[field.fieldKey];
    const empty = raw === undefined || raw === null || raw === "";
    if (field.required && empty) {
      errors[field.fieldKey] = "This field is required.";
      continue;
    }
    if (empty) continue;
    if (field.kind === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) errors[field.fieldKey] = "Must be a number.";
    }
    if (field.kind === "radio" || field.kind === "select") {
      const allowed = field.options.map((o) => String(o.value));
      if (!allowed.includes(String(raw))) errors[field.fieldKey] = "Not a valid choice.";
    }
  }
  return errors;
}
