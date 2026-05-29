import type { Diagnosis } from "@/components/encounter/DiagnosisPicker";
import type { ServiceLine } from "@/components/encounter/CptCodePanel";
import { analyzeMedicaidDocumentation } from "@/lib/encounters/medicaidCodeDetection";
import type { SoapNoteData } from "@/components/encounter/SoapNoteEditor";
import {
  getAnswerList,
  getAnswerString,
  getNumberAnswer,
  isYes,
  type CodingQuestionnaireAnswers,
} from "./questionnaire";

export type CodingRecommendation = {
  code: string;
  title: string;
  status: "suggest" | "consider";
  confidence: "high" | "moderate" | "low";
  explanation: string;
  documentationGaps: string[];
};

export type CodingQuestionnaireAnalysis = {
  suggestedCodes: string[];
  recommendations: CodingRecommendation[];
  auditSummary: string;
  documentationWarnings: string[];
  screeningDetails: string[];
  careCoordinationDetails: string[];
  peerSupportDetails: string[];
  psychoeducationDetails: string[];
  formSummary: string;
  sourceSnapshot: string;
};

export type AnalyzeCodingQuestionnaireParams = {
  answers: CodingQuestionnaireAnswers;
  soapNote: SoapNoteData;
  diagnoses: Diagnosis[];
  serviceLines: ServiceLine[];
  payerName?: string | null;
  isMedicaid: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function joinHuman(values: string[]): string {
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function buildSourceSnapshot(params: AnalyzeCodingQuestionnaireParams): string {
  const { answers, soapNote, diagnoses, serviceLines, payerName, isMedicaid } = params;
  const diagnosisSummary = diagnoses
    .filter((item) => clean(item.diagnosis_code))
    .map((item) => `${clean(item.diagnosis_code)}${clean(item.diagnosis_description) ? ` (${clean(item.diagnosis_description)})` : ""}`)
    .join(", ");

  const serviceSummary = serviceLines
    .map((item) => {
      const code = clean(item.cpt_hcpcs_code) || "(uncoded)";
      const units = Number.isFinite(Number(item.units)) ? Number(item.units) : 1;
      const date = clean(item.service_date);
      return `${code} x${units}${date ? ` on ${date}` : ""}`;
    })
    .join("; ");

  return [
    `Payer: ${clean(payerName) || "Unknown"}`,
    `Coverage: ${isMedicaid ? "Medicaid" : "Non-Medicaid"}`,
    clean(soapNote.subjective) ? `Subjective: ${clean(soapNote.subjective)}` : "",
    clean(soapNote.objective) ? `Objective: ${clean(soapNote.objective)}` : "",
    clean(soapNote.assessment) ? `Assessment: ${clean(soapNote.assessment)}` : "",
    clean(soapNote.plan) ? `Plan: ${clean(soapNote.plan)}` : "",
    diagnosisSummary ? `Diagnoses: ${diagnosisSummary}` : "",
    serviceSummary ? `Service Lines: ${serviceSummary}` : "",
    clean(getAnswerString(answers, "contextShort")) ? `Questionnaire Context: ${getAnswerString(answers, "contextShort")}` : "",
    clean(getAnswerString(answers, "supportingDetails")) ? `Supporting Details: ${getAnswerString(answers, "supportingDetails")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function psychotherapyCode(minutes: number | null): string[] {
  if (!minutes) return [];
  if (minutes >= 75 && minutes <= 90) return ["90834 x 2"];
  if (minutes >= 53) return ["90837"];
  if (minutes >= 39) return ["90834"];
  if (minutes >= 16) return ["90832"];
  if (minutes >= 8) return ["H0004"];
  return [];
}

function pushRecommendation(list: CodingRecommendation[], recommendation: CodingRecommendation | null) {
  if (recommendation) list.push(recommendation);
}

function buildRecommendation(params: {
  code: string;
  title: string;
  signals: string[];
  gaps: string[];
  gatePassed: boolean;
  minimumHigh?: number;
  minimumModerate?: number;
}): CodingRecommendation | null {
  const { code, title, signals, gaps, gatePassed, minimumHigh = 3, minimumModerate = 2 } = params;
  if (!gatePassed || signals.length < minimumModerate) return null;
  const confidence = signals.length >= minimumHigh ? "high" : "moderate";
  return {
    code,
    title,
    status: "suggest",
    confidence,
    explanation: `${code} is supported because ${joinHuman(signals.map((signal) => signal.toLowerCase()))} were documented.`,
    documentationGaps: gaps,
  };
}

export function analyzeCodingQuestionnaire(params: AnalyzeCodingQuestionnaireParams): CodingQuestionnaireAnalysis {
  const { answers, soapNote, diagnoses, serviceLines, isMedicaid } = params;
  const sourceSnapshot = buildSourceSnapshot(params);
  const noteAnalysis = sourceSnapshot ? analyzeMedicaidDocumentation(sourceSnapshot) : null;
  const recommendations: CodingRecommendation[] = [];
  const documentationWarnings = new Set<string>(noteAnalysis?.globalWarnings ?? []);
  const screeningDetails: string[] = [];
  const careCoordinationDetails: string[] = [];
  const peerSupportDetails: string[] = [];
  const psychoeducationDetails: string[] = [];

  const totalMinutes = getNumberAnswer(answers, "totalMinutes");
  const diagnosisCodes = diagnoses.map((item) => clean(item.diagnosis_code)).filter(Boolean);
  const screenTools = getAnswerList(answers, "screenTools");
  const screenAction = getAnswerString(answers, "screenAction");
  const screenScores = getAnswerString(answers, "screenScores");
  const hasFormalScreen = isYes(answers, "screenUsed") || screenTools.length > 0;

  if (screenTools.length) screeningDetails.push(`Screening tools: ${screenTools.join(", ")}`);
  if (screenAction && screenAction !== "none") screeningDetails.push(`Screening result used for: ${screenAction}`);
  if (screenScores) screeningDetails.push(`Screening scores/findings: ${screenScores}`);
  if (isYes(answers, "screenScored")) screeningDetails.push("Score documented");
  if (isYes(answers, "screenInterpreted")) screeningDetails.push("Results interpreted with client");

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H0002",
      title: "Behavioral Health Screening",
      gatePassed: hasFormalScreen,
      signals: [
        hasFormalScreen ? "a validated screening tool" : "",
        isYes(answers, "screenScored") || !!screenScores ? "screening results" : "",
        isYes(answers, "screenInterpreted") ? "result interpretation" : "",
        ["referral", "triage", "further-assessment"].includes(screenAction) ? "screening-informed next steps" : "",
      ].filter(Boolean),
      gaps: [
        hasFormalScreen ? "" : "Document the formal screening tool used.",
        isYes(answers, "screenScored") || !!screenScores ? "" : "Document the screening score or result.",
        isYes(answers, "screenInterpreted") ? "" : "Document how the result was interpreted and discussed.",
      ].filter(Boolean),
    }),
  );

  const h0031Signals = [
    isYes(answers, "newConcerns") ? "new symptoms" : "",
    isYes(answers, "symptomProgression") ? "symptom change" : "",
    isYes(answers, "mh_risk") ? "risk assessment" : "",
    isYes(answers, "mh_dxClarified") ? "diagnostic clarification" : "",
    isYes(answers, "mh_reassessment") || isYes(answers, "mh_dxRevised") ? "reassessment work" : "",
    ["mh_social", "mh_work", "mh_adl", "mh_cognitive"].some((key) => isYes(answers, key)) ? "functional impact review" : "",
  ].filter(Boolean);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H0031",
      title: "Behavioral Health Assessment",
      gatePassed: h0031Signals.length > 0,
      signals: h0031Signals,
      gaps: [
        h0031Signals.some((signal) => signal.includes("functional impact")) ? "" : "Document functional impairment across one or more domains.",
        isYes(answers, "mh_risk") ? "" : "Document risk or safety findings when relevant.",
      ].filter(Boolean),
    }),
  );

  const h0001Signals = [
    isYes(answers, "substanceUse") ? "substance use review" : "",
    isYes(answers, "cravingsAssessment") ? "cravings or relapse risk assessment" : "",
    isYes(answers, "triggersIdentification") ? "trigger review" : "",
    isYes(answers, "treatmentHistory") ? "treatment or recovery history" : "",
    isYes(answers, "asamFactors") ? "ASAM or level-of-care review" : "",
  ].filter(Boolean);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H0001",
      title: "Alcohol and Drug Assessment",
      gatePassed: isYes(answers, "substanceUse"),
      signals: h0001Signals,
      gaps: [
        isYes(answers, "substanceUse") ? "" : "Document that substance use was assessed.",
        isYes(answers, "cravingsAssessment") || isYes(answers, "triggersIdentification") ? "" : "Document relapse risk, cravings, or triggers.",
      ].filter(Boolean),
    }),
  );

  const h0032Signals = [
    isYes(answers, "plan_initial") ? "initial plan development" : "",
    isYes(answers, "plan_goalsRevised") ? "goal revision" : "",
    isYes(answers, "plan_objectives") ? "objective updates" : "",
    isYes(answers, "plan_interventions") ? "intervention changes" : "",
    isYes(answers, "plan_progress") ? "progress review" : "",
    isYes(answers, "plan_barriers") ? "barrier review" : "",
    isYes(answers, "plan_collaboration") ? "client collaboration" : "",
    getAnswerString(answers, "planReason") !== "none" ? "documented rationale for plan work" : "",
  ].filter(Boolean);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H0032",
      title: "Treatment Plan Development or Review",
      gatePassed: h0032Signals.length > 0,
      signals: h0032Signals,
      gaps: [
        isYes(answers, "plan_goalsRevised") || isYes(answers, "plan_objectives") || isYes(answers, "plan_interventions") ? "" : "Document actual goal, objective, or intervention changes.",
        getAnswerString(answers, "planReason") !== "none" ? "" : "Document why plan work was clinically necessary.",
      ].filter(Boolean),
    }),
  );

  const t1016Signals = [
    isYes(answers, "crisisStabilization") ? "crisis stabilization" : "",
    isYes(answers, "careCoordination") ? "care coordination" : "",
    isYes(answers, "communityResourcesLinked") ? "community linkage" : "",
    isYes(answers, "benefitNavigation") ? "benefits navigation" : "",
    isYes(answers, "collateralContact") ? "collateral contact" : "",
    isYes(answers, "referralsMade") ? "referrals" : "",
    isYes(answers, "crisisSafetyPlan") ? "safety planning" : "",
  ].filter(Boolean);
  careCoordinationDetails.push(...t1016Signals);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "T1016",
      title: "Targeted Case Management / Crisis Services",
      gatePassed: t1016Signals.length > 0,
      signals: t1016Signals,
      gaps: [
        t1016Signals.length ? "" : "Document the coordination, crisis, or linkage work performed.",
        isYes(answers, "collateralContact") || isYes(answers, "referralsMade") || isYes(answers, "communityResourcesLinked") ? "" : "Document specific contacts, referrals, or resources linked.",
      ].filter(Boolean),
    }),
  );

  const h0038Signals = [
    isYes(answers, "livedExpertiseShared") ? "lived experience support" : "",
    isYes(answers, "peerRecoveryPlanning") ? "recovery planning" : "",
    isYes(answers, "peerSystemNavigation") ? "system navigation" : "",
    isYes(answers, "peerSkillBuilding") ? "skill building" : "",
    isYes(answers, "peerMutualSupport") ? "mutual support" : "",
    isYes(answers, "recoveryMilestonesReviewed") ? "recovery progress review" : "",
  ].filter(Boolean);
  peerSupportDetails.push(...h0038Signals);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H0038",
      title: "Peer Support Specialist Services",
      gatePassed: h0038Signals.length > 0,
      signals: h0038Signals,
      gaps: [
        isYes(answers, "livedExpertiseShared") ? "" : "Document the peer-support relationship or lived-experience element.",
        isYes(answers, "peerRecoveryPlanning") || isYes(answers, "peerSystemNavigation") || isYes(answers, "peerSkillBuilding") ? "" : "Document the recovery planning, navigation, or skill-building activity.",
      ].filter(Boolean),
    }),
  );

  const h2017Signals = [
    isYes(answers, "diagnosisEducation") ? "diagnosis education" : "",
    isYes(answers, "symptomManagementEdu") ? "symptom management teaching" : "",
    isYes(answers, "copingSkillsEdu") ? "coping skills education" : "",
    isYes(answers, "treatmentRationaleEdu") ? "treatment rationale education" : "",
    isYes(answers, "medicationEducationEdu") ? "medication education" : "",
    isYes(answers, "familyEducationEdu") ? "family/support education" : "",
    isYes(answers, "relapsePrevEdu") ? "relapse prevention education" : "",
  ].filter(Boolean);
  psychoeducationDetails.push(...h2017Signals);

  pushRecommendation(
    recommendations,
    buildRecommendation({
      code: "H2017",
      title: "Psychoeducational Services",
      gatePassed: h2017Signals.length > 0,
      signals: h2017Signals,
      gaps: [
        h2017Signals.length ? "" : "Document the structured psychoeducation topic or activity.",
        isYes(answers, "familyEducationEdu") ? "" : "Document who received the education and how it linked to treatment goals.",
      ].filter(Boolean),
    }),
  );

  const heuristicCodes = Array.from(
    new Set(
      (noteAnalysis?.recommendations ?? [])
        .filter((item) => item.action === "suggest" || item.action === "clarify_before_suggesting")
        .map((item) => item.code),
    ),
  );

  const psychotherapyCodes = psychotherapyCode(totalMinutes);
  const suggestedCodes = Array.from(
    new Set([...recommendations.map((item) => item.code), ...psychotherapyCodes, ...heuristicCodes]),
  );

  if (totalMinutes !== null && totalMinutes < 16) {
    documentationWarnings.add("Session duration is under 16 minutes, so time-based psychotherapy support is limited.");
  }
  if (!diagnosisCodes.length) {
    documentationWarnings.add("No diagnosis code is currently attached to the encounter.");
  }
  if (!serviceLines.length) {
    documentationWarnings.add("No service lines are currently present on the encounter.");
  }
  if (!hasFormalScreen && (isYes(answers, "screenScored") || isYes(answers, "screenInterpreted") || !!screenScores)) {
    documentationWarnings.add("Screening results were documented without identifying a formal validated tool.");
  }
  if (isMedicaid && !recommendedHeuristicCoverage(noteAnalysis)) {
    documentationWarnings.add("Medicaid note heuristics found limited structured documentation support in the SOAP text.");
  }

  const auditSummaryParts = [
    recommendations.length
      ? `Questionnaire-supported codes: ${recommendations.map((item) => item.code).join(", ")}.`
      : "Questionnaire inputs did not meet recommendation thresholds for a non-psychotherapy add-on code.",
    psychotherapyCodes.length
      ? `Time-based psychotherapy support: ${psychotherapyCodes.join(", ")} from ${totalMinutes ?? "unknown"} minutes.`
      : "No psychotherapy duration code was inferred from the recorded minutes.",
    noteAnalysis?.auditSummary.length ? noteAnalysis.auditSummary.join(" ") : "",
  ].filter(Boolean);

  const formSummary = [
    `Minutes: ${totalMinutes ?? "N/A"}`,
    `Suggested codes: ${suggestedCodes.length ? suggestedCodes.join(", ") : "None"}`,
    screeningDetails.length ? `Screening: ${screeningDetails.join("; ")}` : "",
    careCoordinationDetails.length ? `Care coordination: ${careCoordinationDetails.join("; ")}` : "",
    peerSupportDetails.length ? `Peer support: ${peerSupportDetails.join("; ")}` : "",
    psychoeducationDetails.length ? `Psychoeducation: ${psychoeducationDetails.join("; ")}` : "",
    getAnswerString(answers, "followUp") ? `Follow-up: ${getAnswerString(answers, "followUp")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    suggestedCodes,
    recommendations,
    auditSummary: auditSummaryParts.join(" "),
    documentationWarnings: Array.from(documentationWarnings),
    screeningDetails,
    careCoordinationDetails,
    peerSupportDetails,
    psychoeducationDetails,
    formSummary,
    sourceSnapshot,
  };
}

function recommendedHeuristicCoverage(analysis: ReturnType<typeof analyzeMedicaidDocumentation> | null): boolean {
  if (!analysis) return false;
  return analysis.recommendations.some((item) => item.action === "suggest" || item.action === "clarify_before_suggesting");
}