export type MedicaidCode = "H0031" | "H0032" | "H0001" | "H0002";

export type Confidence = "very_high" | "high" | "moderate" | "possible" | "low" | "blocked";

export type RecommendationAction =
  | "suggest"
  | "clarify_before_suggesting"
  | "do_not_suggest"
  | "blocked";

export type MatchCategory =
  | "screening"
  | "mental_health_assessment"
  | "substance_use_assessment"
  | "treatment_planning"
  | "psychotherapy"
  | "risk"
  | "functioning"
  | "diagnosis"
  | "symptoms"
  | "medical_necessity"
  | "documentation_blocker";

export interface DetectionMatch {
  category: MatchCategory;
  label: string;
  evidence: string[];
  weight: number;
}

export interface CodeRecommendation {
  code: MedicaidCode;
  label: string;
  confidence: Confidence;
  action: RecommendationAction;
  score: number;
  matchedConcepts: DetectionMatch[];
  missingElements: string[];
  blockers: DetectionMatch[];
  explanation: string;
  clarificationQuestion?: string;
  documentationSuggestion?: string;
}

export interface MedicaidDetectionResult {
  primaryServiceDetected: "psychotherapy" | "screening" | "assessment" | "treatment_planning" | "mixed" | "unclear";
  recommendations: CodeRecommendation[];
  psychotherapyIndicators: DetectionMatch[];
  globalWarnings: string[];
  auditSummary: string[];
}

interface Rule {
  label: string;
  category: MatchCategory;
  weight: number;
  patterns: RegExp[];
}

interface CodeConfig {
  code: MedicaidCode;
  label: string;
  suggestThreshold: number;
  clarifyThreshold: number;
  hardTriggers: Rule[];
  softTriggers: Rule[];
  blockers: Rule[];
  requiredForHighConfidence: string[];
  clarificationQuestion: string;
  documentationSuggestion: string;
}

const normalizeText = (text: string): string =>
  text
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const splitSentences = (text: string): string[] => {
  const normalized = normalizeText(text);
  return normalized
    .split(/(?<=[.!?])\s+|\n+|\|/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
};

const findEvidence = (sentences: string[], patterns: RegExp[], maxEvidence = 4): string[] => {
  const evidence: string[] = [];
  for (const sentence of sentences) {
    if (patterns.some((pattern) => pattern.test(sentence))) {
      evidence.push(sentence);
    }
    if (evidence.length >= maxEvidence) break;
  }
  return evidence;
};

const applyRules = (sentences: string[], rules: Rule[]): DetectionMatch[] => {
  return rules
    .map((rule) => ({ ...rule, evidence: findEvidence(sentences, rule.patterns) }))
    .filter((match) => match.evidence.length > 0)
    .map((match) => ({
      category: match.category,
      label: match.label,
      evidence: match.evidence,
      weight: match.weight,
    }));
};

const totalScore = (matches: DetectionMatch[]): number =>
  matches.reduce((sum, match) => sum + match.weight, 0);

const clampScore = (score: number): number => Math.max(0, Math.min(score, 150));

const regex = (source: string): RegExp => new RegExp(source, "i");

const commonPsychotherapyRules: Rule[] = [
  {
    label: "psychotherapy intervention",
    category: "psychotherapy",
    weight: 30,
    patterns: [
      regex("\\b(CBT|DBT|ACT|IFS|EMDR|Gestalt|mindfulness|grounding|cognitive defusion|cognitive restructuring)\\b"),
      regex("\\b(validation|reflection|supportive counseling|empathetic exploration|processed|processing|explored feelings)\\b"),
    ],
  },
  {
    label: "skills or therapeutic techniques",
    category: "psychotherapy",
    weight: 25,
    patterns: [
      regex("\\b(boundary development|communication skills|emotion identification|coping skills|stress reduction|breathing|butterfly taps|art therapy)\\b"),
      regex("\\b(challenging beliefs|reframing|values clarification|attachment needs|relationship dynamics)\\b"),
    ],
  },
  {
    label: "routine therapy continuation",
    category: "psychotherapy",
    weight: 15,
    patterns: [
      regex("\\b(continue weekly therapy|continue current interventions|next session|engaged|participated|demonstrated understanding)\\b"),
    ],
  },
];

const h0002Config: CodeConfig = {
  code: "H0002",
  label: "Behavioral Health Screening",
  suggestThreshold: 85,
  clarifyThreshold: 45,
  hardTriggers: [
    {
      label: "validated screening tool used",
      category: "screening",
      weight: 100,
      patterns: [
        regex("\\b(PHQ[- ]?9|GAD[- ]?7|AUDIT[- ]?C?|DAST[- ]?10?|CAGE|PCL[- ]?5|CSSRS|C-SSRS|Columbia Suicide Severity Rating Scale|MDQ)\\b"),
        regex("\\b(validated screening|standardized screening|screening tool|administered .*screen)\\b"),
      ],
    },
  ],
  softTriggers: [
    {
      label: "screening score documented",
      category: "screening",
      weight: 25,
      patterns: [regex("\\b(score|scored|screening results|above threshold|moderate range|severe range|mild range)\\b")],
    },
    {
      label: "screening outcome used clinically",
      category: "screening",
      weight: 25,
      patterns: [regex("\\b(warrants|indicat(?:es|ed)|eligible|triage|referral|further assessment|outpatient services)\\b")],
    },
  ],
  blockers: [
    {
      label: "informal symptom discussion only",
      category: "documentation_blocker",
      weight: 100,
      patterns: [regex("\\b(no screening tool|informal check[- ]?in|client reports anxiety|client reports depression)\\b")],
    },
  ],
  requiredForHighConfidence: ["validated screening tool used"],
  clarificationQuestion: "Did you administer and interpret a formal screening tool such as PHQ-9, GAD-7, AUDIT-C, DAST-10, CAGE, PCL-5, or C-SSRS today?",
  documentationSuggestion: "Document the tool name, score/results, interpretation, reason for screening, outcome discussed with the client, and any referral or next clinical decision.",
};

const h0031Config: CodeConfig = {
  code: "H0031",
  label: "Biopsychosocial / Mental Health Assessment",
  suggestThreshold: 85,
  clarifyThreshold: 55,
  hardTriggers: [
    {
      label: "initial or reassessment language",
      category: "mental_health_assessment",
      weight: 80,
      patterns: [regex("\\b(initial mental health intake|biopsychosocial assessment|mental health reassessment|reassessed|assessment of current presentation|clinical reassessment)\\b")],
    },
    {
      label: "diagnostic clarification",
      category: "diagnosis",
      weight: 45,
      patterns: [regex("\\b(diagnostic clarification|diagnostic impression|diagnosis reviewed|diagnosis revised|DSM[- ]?5 criteria|differential diagnos(?:is|es)|clinical impression)\\b")],
    },
  ],
  softTriggers: [
    {
      label: "symptom review",
      category: "symptoms",
      weight: 25,
      patterns: [regex("\\b(worsening symptoms|new symptoms|symptom severity|depressive symptoms|anxiety symptoms|panic|avoidance|low mood|hopelessness|fatigue|sleep disturbance|irritability|social withdrawal)\\b")],
    },
    {
      label: "functioning reviewed",
      category: "functioning",
      weight: 25,
      patterns: [regex("\\b(functioning|daily functioning|occupational|employment|school|relationship|financial stability|budgeting|transportation|housing|ADLs|social functioning|work functioning)\\b")],
    },
    {
      label: "risk assessed",
      category: "risk",
      weight: 30,
      patterns: [regex("\\b(risk assessment|suicidal ideation|passive suicidality|self[- ]?harm|safety plan|denies suicidal ideation|homicidal ideation|no risk identified|risk identified)\\b")],
    },
    {
      label: "history or psychosocial context reviewed",
      category: "mental_health_assessment",
      weight: 20,
      patterns: [regex("\\b(history of presenting problem|past psychiatric history|trauma history|childhood|family dynamics|medical history|chronic health|kidney failure|psychosocial stressors|major life change|recent job loss)\\b")],
    },
    {
      label: "clinical formulation language",
      category: "mental_health_assessment",
      weight: 20,
      patterns: [regex("\\b(clinical presentation|protective parts|barriers to feelings|somatic safety|bodily awareness|attachment needs|emotional functioning|cognitive functioning|behavioral functioning)\\b")],
    },
  ],
  blockers: [
    {
      label: "screening only",
      category: "documentation_blocker",
      weight: 100,
      patterns: [regex("\\b(screening only|brief screen only)\\b")],
    },
  ],
  requiredForHighConfidence: ["symptom review", "functioning reviewed", "diagnostic clarification"],
  clarificationQuestion: "Did today's session include reassessment of symptoms, functioning, diagnosis, or risk beyond routine psychotherapy?",
  documentationSuggestion: "Document whether this was an initial assessment or reassessment, the reason for assessment, current symptoms/severity, functioning domains, risk findings, diagnostic impression, and clinical rationale.",
};

const h0001Config: CodeConfig = {
  code: "H0001",
  label: "Alcohol / Drug Assessment",
  suggestThreshold: 85,
  clarifyThreshold: 55,
  hardTriggers: [
    {
      label: "SUD assessment language",
      category: "substance_use_assessment",
      weight: 90,
      patterns: [regex("\\b(substance use assessment|SUD assessment|alcohol/drug assessment|ASAM|level of care determination|court[- ]?ordered substance assessment)\\b")],
    },
    {
      label: "SUD diagnosis or criteria",
      category: "diagnosis",
      weight: 45,
      patterns: [regex("\\b(substance use disorder|opioid use disorder|alcohol use disorder|cannabis use disorder|stimulant use disorder|DSM[- ]?5 criteria.*substance|moderate .*use disorder|severe .*use disorder)\\b")],
    },
  ],
  softTriggers: [
    {
      label: "substance use pattern reviewed",
      category: "substance_use_assessment",
      weight: 35,
      patterns: [regex("\\b(frequency|quantity|duration|route of use|method of use|last use|daily alcohol|binge|relapse episodes|current relapse|history of alcohol|methamphetamine|opioid|cannabis)\\b")],
    },
    {
      label: "relapse or recovery risk reviewed",
      category: "substance_use_assessment",
      weight: 25,
      patterns: [regex("\\b(relapse|cravings|withdrawal|tolerance|triggers|harm reduction|sober support|recovery supports|readiness to change)\\b")],
    },
    {
      label: "SUD functional or legal impact",
      category: "functioning",
      weight: 25,
      patterns: [regex("\\b(probation|legal issues|court|DUI|IOP|detox|MAT|rehab|sober living|substance.*employment|substance.*relationship|use impacting)\\b")],
    },
  ],
  blockers: [
    {
      label: "substance use denied or incidental",
      category: "documentation_blocker",
      weight: 100,
      patterns: [regex("\\b(substance use was denied|denied substance use|occasional cannabis use for anxiety|substance use not addressed|history only)\\b")],
    },
    {
      label: "SUD case management only",
      category: "documentation_blocker",
      weight: 100,
      patterns: [regex("\\b(referral only|case management only|coordinated with MAT|provided contact information)\\b")],
    },
  ],
  requiredForHighConfidence: ["substance use pattern reviewed", "SUD diagnosis or criteria"],
  clarificationQuestion: "Did you complete a structured review of substance use history, relapse risk, severity, ASAM dimensions, diagnosis, or level-of-care needs today?",
  documentationSuggestion: "Document substances used, frequency, quantity, duration, route/method, last use, relapse triggers, withdrawal/tolerance/cravings, ASAM or structured framework, functional/legal impact, diagnostic impression, and level-of-care/referral decision.",
};

const h0032Config: CodeConfig = {
  code: "H0032",
  label: "Treatment Planning",
  suggestThreshold: 80,
  clarifyThreshold: 45,
  hardTriggers: [
    {
      label: "formal treatment plan activity",
      category: "treatment_planning",
      weight: 90,
      patterns: [regex("\\b(treatment plan review|treatment plan updated|treatment plan revised|formal plan review|initial treatment plan|quarterly treatment plan|discharge planning)\\b")],
    },
    {
      label: "goals or objectives revised",
      category: "treatment_planning",
      weight: 70,
      patterns: [regex("\\b(goal[s]? updated|goal[s]? revised|objective[s]? updated|objective[s]? revised|new objective|measurable goal|estimated date of completion|status: no improvement|partial progress)\\b")],
    },
  ],
  softTriggers: [
    {
      label: "goals documented",
      category: "treatment_planning",
      weight: 35,
      patterns: [regex("\\b(goal 1|goal 2|goals include|client goals|treatment goals|working on depression|working on trauma|psychological flexibility)\\b")],
    },
    {
      label: "intervention planning",
      category: "treatment_planning",
      weight: 30,
      patterns: [regex("\\b(interventions adjusted|interventions changed|treatment approach|will emphasize|will continue focusing|next steps include|future sessions will aim|ACT approaches|somatic interventions|IFS parts work)\\b")],
    },
    {
      label: "frequency or modality planning",
      category: "treatment_planning",
      weight: 25,
      patterns: [regex("\\b(weekly therapy|twice weekly|once weekly|treatment frequency|session frequency|medical leave|therapy during treatment leave|estimated length of treatment|individual therapy)\\b")],
    },
    {
      label: "progress or barriers reviewed",
      category: "treatment_planning",
      weight: 25,
      patterns: [regex("\\b(progress|barriers|maintained|no improvement|partial progress|assessment of progress|clinical goals|barriers that prevent access)\\b")],
    },
    {
      label: "collaborative care planning",
      category: "treatment_planning",
      weight: 20,
      patterns: [regex("\\b(shared with .*team|collaborative care|ketamine provider|treating physician|medical provider|coordinate with provider|treatment team)\\b")],
    },
  ],
  blockers: [
    {
      label: "goals referenced only",
      category: "documentation_blocker",
      weight: 100,
      patterns: [regex("\\b(continue current interventions|treatment plan will continue|plan remains unchanged|no homework|no intersession activities)\\b")],
    },
    {
      label: "future session planning only",
      category: "documentation_blocker",
      weight: 75,
      patterns: [regex("\\b(next session will focus|future sessions will aim|next session is scheduled)\\b")],
    },
  ],
  requiredForHighConfidence: ["formal treatment plan activity", "goals or objectives revised", "goals documented"],
  clarificationQuestion: "Did you formally review or revise treatment goals, objectives, interventions, service frequency, or the treatment plan today?",
  documentationSuggestion: "Document the reason for plan review/update, diagnosis addressed, goals/objectives, measurable targets, interventions, responsible party, client participation, progress/barriers, and any changes to frequency or modality.",
};

const codeConfigs: CodeConfig[] = [h0002Config, h0031Config, h0001Config, h0032Config];

function determineConfidence(score: number, action: RecommendationAction, hasHardTrigger: boolean): Confidence {
  if (action === "blocked") return "blocked";
  if (action === "do_not_suggest") return "low";
  if (score >= 115 && hasHardTrigger) return "very_high";
  if (score >= 90) return "high";
  if (score >= 70) return "moderate";
  if (score >= 45) return "possible";
  return "low";
}

function buildExplanation(
  config: CodeConfig,
  action: RecommendationAction,
  matches: DetectionMatch[],
  blockers: DetectionMatch[],
): string {
  const concepts = matches.map((match) => match.label).join(", ");
  const blockerText = blockers.map((match) => match.label).join(", ");

  if (action === "suggest") {
    return `${config.code} triggered because the documentation reflects ${concepts}.`;
  }

  if (action === "clarify_before_suggesting") {
    return `${config.code} is possible, but the documentation should be clarified before recommending the code. Detected: ${concepts || "limited supporting concepts"}.${blockerText ? ` Potential limitation: ${blockerText}.` : ""}`;
  }

  return `${config.code} was not recommended because documentation did not meet the conservative threshold for ${config.label}.${blockerText ? ` Limitation detected: ${blockerText}.` : ""}`;
}

function buildRecommendation(config: CodeConfig, sentences: string[]): CodeRecommendation {
  const hardMatches = applyRules(sentences, config.hardTriggers);
  const softMatches = applyRules(sentences, config.softTriggers);
  const blockerMatches = applyRules(sentences, config.blockers);
  const matchedConcepts = [...hardMatches, ...softMatches];
  const rawScore = totalScore(matchedConcepts);

  const hasHardTrigger = hardMatches.length > 0;
  const hasBlocker = blockerMatches.length > 0;

  let adjustedScore = rawScore;

  if (config.code === "H0032" && hasBlocker && !hasHardTrigger) {
    adjustedScore -= 30;
  }

  if (config.code === "H0031") {
    const onlyRisk = matchedConcepts.length === 1 && matchedConcepts[0]?.label === "risk assessed";
    if (onlyRisk) adjustedScore -= 30;
  }

  adjustedScore = clampScore(adjustedScore);

  let action: RecommendationAction;
  if (hasBlocker && adjustedScore < config.suggestThreshold) {
    action = adjustedScore >= config.clarifyThreshold ? "clarify_before_suggesting" : "do_not_suggest";
  } else if (adjustedScore >= config.suggestThreshold) {
    action = "suggest";
  } else if (adjustedScore >= config.clarifyThreshold) {
    action = "clarify_before_suggesting";
  } else {
    action = "do_not_suggest";
  }

  const confidence = determineConfidence(adjustedScore, action, hasHardTrigger);
  const missingElements = config.requiredForHighConfidence.filter(
    (required) => !matchedConcepts.some((match) => match.label === required),
  );

  return {
    code: config.code,
    label: config.label,
    confidence,
    action,
    score: adjustedScore,
    matchedConcepts,
    missingElements,
    blockers: blockerMatches,
    explanation: buildExplanation(config, action, matchedConcepts, blockerMatches),
    clarificationQuestion: action === "clarify_before_suggesting" ? config.clarificationQuestion : undefined,
    documentationSuggestion: action !== "do_not_suggest" ? config.documentationSuggestion : undefined,
  };
}

function determinePrimaryService(recommendations: CodeRecommendation[], psychotherapyScore: number): MedicaidDetectionResult["primaryServiceDetected"] {
  const suggested = recommendations.filter((rec) => rec.action === "suggest");
  const hasAssessment = suggested.some((rec) => rec.code === "H0031" || rec.code === "H0001");
  const hasScreening = suggested.some((rec) => rec.code === "H0002");
  const hasPlanning = suggested.some((rec) => rec.code === "H0032");

  if (psychotherapyScore >= 55 && suggested.length === 0) return "psychotherapy";
  if (psychotherapyScore >= 55 && suggested.length > 0) return "mixed";
  if (hasAssessment && hasPlanning) return "mixed";
  if (hasAssessment) return "assessment";
  if (hasPlanning) return "treatment_planning";
  if (hasScreening) return "screening";
  return "unclear";
}

function buildAuditSummary(recommendations: CodeRecommendation[], psychotherapyIndicators: DetectionMatch[]): string[] {
  const lines: string[] = [];
  const suggested = recommendations.filter((rec) => rec.action === "suggest");
  const clarify = recommendations.filter((rec) => rec.action === "clarify_before_suggesting");

  if (psychotherapyIndicators.length > 0) {
    lines.push("Psychotherapy indicators were detected, so assessment and planning codes were evaluated conservatively to avoid over-triggering routine therapy notes.");
  }

  if (suggested.length > 0) {
    lines.push(`Suggested codes: ${suggested.map((rec) => rec.code).join(", ")}.`);
  }

  if (clarify.length > 0) {
    lines.push(`Clarification needed before suggesting: ${clarify.map((rec) => rec.code).join(", ")}.`);
  }

  if (suggested.length === 0 && clarify.length === 0) {
    lines.push("No assessment, screening, SUD assessment, or treatment planning code met the recommendation threshold.");
  }

  return lines;
}

export function analyzeMedicaidDocumentation(inputText: string): MedicaidDetectionResult {
  const sentences = splitSentences(inputText);
  const psychotherapyIndicators = applyRules(sentences, commonPsychotherapyRules);
  const psychotherapyScore = totalScore(psychotherapyIndicators);

  const recommendations = codeConfigs
    .map((config) => buildRecommendation(config, sentences))
    .sort((a, b) => b.score - a.score);

  const globalWarnings: string[] = [];
  if (!/\b(start time|end time|\d{1,2}:\d{2}|\d{1,2}\s?(am|pm))\b/i.test(inputText)) {
    globalWarnings.push("Start/end time or duration was not clearly detected. Required for clean billing support.");
  }
  if (!/\b(telehealth|office|client'?s home|home|school|shelter|place of service|location)\b/i.test(inputText)) {
    globalWarnings.push("Session location/place of service was not clearly detected.");
  }
  if (!/\b(consent|verbal consent|client consented)\b/i.test(inputText)) {
    globalWarnings.push("Consent language was not clearly detected, which may matter for telehealth documentation.");
  }

  return {
    primaryServiceDetected: determinePrimaryService(recommendations, psychotherapyScore),
    recommendations,
    psychotherapyIndicators,
    globalWarnings,
    auditSummary: buildAuditSummary(recommendations, psychotherapyIndicators),
  };
}

export function getSuggestedCodes(result: MedicaidDetectionResult): MedicaidCode[] {
  return result.recommendations
    .filter((rec) => rec.action === "suggest")
    .map((rec) => rec.code);
}

export function getClarifyingQuestions(result: MedicaidDetectionResult): string[] {
  return result.recommendations
    .filter((rec) => rec.action === "clarify_before_suggesting" && rec.clarificationQuestion)
    .map((rec) => rec.clarificationQuestion as string);
}

export function formatRecommendationSummary(result: MedicaidDetectionResult): string {
  const lines: string[] = [];
  lines.push(`Primary service detected: ${result.primaryServiceDetected}`);

  for (const rec of result.recommendations) {
    if (rec.action === "do_not_suggest") continue;
    lines.push(`\n${rec.code} - ${rec.label}`);
    lines.push(`Action: ${rec.action}`);
    lines.push(`Confidence: ${rec.confidence}`);
    lines.push(`Score: ${rec.score}`);
    lines.push(`Reason: ${rec.explanation}`);

    if (rec.missingElements.length > 0) {
      lines.push(`Missing/weak elements: ${rec.missingElements.join(", ")}`);
    }

    if (rec.clarificationQuestion) {
      lines.push(`Clarify: ${rec.clarificationQuestion}`);
    }
  }

  if (result.globalWarnings.length > 0) {
    lines.push("\nDocumentation warnings:");
    result.globalWarnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  return lines.join("\n");
}