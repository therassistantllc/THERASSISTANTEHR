import type { MedicaidDetectionResult } from "@/lib/encounters/medicaidCodeDetection";
import type { CodingQuestionnaireScore } from "./scoring";

type CodingQuestionnaireAnswers = Partial<Record<string, string>>;

export type CodingHelperReport = {
  id: string;
  date: string;
  codes: string;
  auditSummary: string;
  codingRationale: string;
  documentationGaps: string[];
  sourceEncounterId: string;
};

type BuildCodingReportParams = {
  encounterId: string;
  answers: CodingQuestionnaireAnswers;
  questionnaireScore: CodingQuestionnaireScore;
  noteAnalysis: MedicaidDetectionResult | null;
};

export function buildCodingReport(params: BuildCodingReportParams): CodingHelperReport {
  const {
    encounterId,
    answers,
    questionnaireScore,
    noteAnalysis,
  } = params;
  const date = new Date().toISOString().slice(0, 10);

  const suggestedCodes = Array.from(new Set(questionnaireScore.suggestedCodes));
  const recommendations = (noteAnalysis?.recommendations ?? []).filter(
    (rec) => rec.action === "suggest",
  );
  const recommendationText = recommendations
    .map((rec) => `${rec.code}: ${rec.explanation}`)
    .join(" ");
  const documentationGaps = recommendations.flatMap((rec) => rec.missingElements);
  const sourceReference = `Generated from encounter ${encounterId} note state on ${new Date().toISOString()}. Clinical note text is not duplicated in this coding report.`;
  const answeredCount = Object.values(answers).filter((value) => String(value ?? "").trim().length > 0).length;

  const auditSummary = [
    questionnaireScore.summary,
    `Questionnaire answered items: ${answeredCount}.`,
    noteAnalysis?.auditSummary.length ? `Note analysis: ${noteAnalysis.auditSummary.join(" ")}` : "",
    sourceReference,
  ].filter(Boolean).join(" ");

  return {
    id: `coding-helper-${encounterId}-${Date.now()}`,
    date,
    codes: suggestedCodes.join(", "),
    auditSummary,
    codingRationale: recommendationText || "No recommendation rows generated.",
    documentationGaps,
    sourceEncounterId: encounterId,
  };
}