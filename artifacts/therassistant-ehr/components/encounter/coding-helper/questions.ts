export type CodingAnswerValue = string | number | string[];

export type CodingQuestionnaireAnswers = Partial<Record<string, CodingAnswerValue>>;

export type CodingQuestionOption = {
  value: string;
  label: string;
  description?: string;
};

export type CodingQuestion = {
  id: string;
  label: string;
  type: "yesNo" | "number" | "select" | "text" | "textarea" | "multiselect";
  helperText?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: CodingQuestionOption[];
  /** If set, this question is only shown when answers[parentId] === showWhen */
  parentId?: string;
  showWhen?: string;
};

export type CodingQuestionSection = {
  id: string;
  title: string;
  description?: string;
  questions: CodingQuestion[];
};

export const SCREENING_TOOL_OPTIONS: CodingQuestionOption[] = [
  { value: "PHQ-9", label: "PHQ-9" },
  { value: "GAD-7", label: "GAD-7" },
  { value: "AUDIT-C", label: "AUDIT-C" },
  { value: "DAST-10", label: "DAST-10" },
  { value: "PCL-5", label: "PCL-5" },
  { value: "C-SSRS", label: "C-SSRS" },
  { value: "MDQ", label: "MDQ" },
  { value: "Other validated tool", label: "Other validated tool" },
];

export const CODING_QUESTIONNAIRE_SECTIONS: CodingQuestionSection[] = [
  {
    id: "session-intake",
    title: "Session Intake",
    description: "Capture the core intake details that drive time and screening logic.",
    questions: [
      { id: "totalMinutes", label: "How many minutes did you spend with this client?", type: "number", min: 1, max: 480 },
      { id: "screenUsed", label: "Was a formal screening tool used?", type: "yesNo" },
      { id: "screenTools", label: "Which screening tools were used?", type: "multiselect", options: SCREENING_TOOL_OPTIONS, parentId: "screenUsed", showWhen: "yes" },
      { id: "screenScored", label: "Did you record the score?", type: "yesNo", parentId: "screenUsed", showWhen: "yes" },
      { id: "screenScores", label: "Document key scores or findings", type: "textarea", placeholder: "Example: PHQ-9 16, GAD-7 12, discussed with client and used for referral.", parentId: "screenScored", showWhen: "yes" },
      { id: "screenInterpreted", label: "Did you discuss what the score means with the client?", type: "yesNo", parentId: "screenUsed", showWhen: "yes" },
      {
        id: "screenAction",
        label: "What did you do with the result?",
        type: "select",
        options: [
          { value: "none", label: "No specific action taken" },
          { value: "referral", label: "Made a referral" },
          { value: "further-assessment", label: "Ordered further assessment" },
          { value: "triage", label: "Used for eligibility decision" },
          { value: "monitoring", label: "Created a monitoring plan" },
        ],
        parentId: "screenUsed",
        showWhen: "yes",
      },
      {
        id: "screenSeverity",
        label: "Overall screening severity",
        type: "select",
        options: [
          { value: "", label: "Select severity" },
          { value: "minimal", label: "Minimal" },
          { value: "mild", label: "Mild" },
          { value: "moderate", label: "Moderate" },
          { value: "moderately severe", label: "Moderately severe" },
          { value: "severe", label: "Severe" },
        ],
        parentId: "screenUsed",
        showWhen: "yes",
      },
      {
        id: "screenClinicalSignificance",
        label: "Clinically significant symptoms",
        type: "select",
        options: [
          { value: "", label: "Select finding" },
          { value: "presence", label: "Presence" },
          { value: "absence", label: "Absence" },
        ],
        parentId: "screenUsed",
        showWhen: "yes",
      },
    ],
  },
  {
    id: "presenting-issues",
    title: "Presenting Issues",
    description: "Review symptoms, history, and substance use.",
    questions: [
      { id: "newConcerns", label: "Did you identify any new concerns or symptoms?", type: "yesNo" },
      { id: "currentExperience", label: "Did you ask what they are experiencing right now?", type: "yesNo" },
      { id: "symptomProgression", label: "Did you assess whether symptoms are improving, worsening, or staying the same?", type: "yesNo" },
      { id: "sessionChanges", label: "Did you review changes since the last session?", type: "yesNo" },
      { id: "severityExploration", label: "Did you explore severity or intensity?", type: "yesNo" },
      { id: "onsetHistory", label: "Did you ask when this started or what has been happening?", type: "yesNo" },
      { id: "strengthsDiscussion", label: "Did you discuss strengths or coping resources?", type: "yesNo" },
      { id: "substanceUse", label: "Did you ask about alcohol or drug use?", type: "yesNo" },
      { id: "cravingsAssessment", label: "Did you assess cravings, urges, or relapse risk?", type: "yesNo", parentId: "substanceUse", showWhen: "yes" },
      { id: "triggersIdentification", label: "Did you identify triggers related to substance use?", type: "yesNo", parentId: "substanceUse", showWhen: "yes" },
      { id: "treatmentHistory", label: "Did you review treatment or recovery history?", type: "yesNo", parentId: "substanceUse", showWhen: "yes" },
      { id: "asamFactors", label: "Did you review ASAM or level-of-care factors?", type: "yesNo", parentId: "substanceUse", showWhen: "yes" },
    ],
  },
  {
    id: "functional-impact",
    title: "Functional Impact",
    description: "Discuss functioning and diagnostic clarification.",
    questions: [
      { id: "mh_social", label: "Did you discuss relationship or social impact?", type: "yesNo" },
      { id: "mh_work", label: "Did you discuss work or school impact?", type: "yesNo" },
      { id: "mh_adl", label: "Did you discuss daily life or self-care impact?", type: "yesNo" },
      { id: "mh_cognitive", label: "Did you discuss thinking, focus, or decision-making impact?", type: "yesNo" },
      { id: "mh_risk", label: "Did you assess risk or safety concerns?", type: "yesNo" },
      { id: "mh_dxClarified", label: "Did you clarify diagnostic fit or differential diagnosis?", type: "yesNo" },
      { id: "mh_dxRevised", label: "Did the diagnosis change?", type: "yesNo", parentId: "mh_dxClarified", showWhen: "yes" },
      { id: "mh_reassessment", label: "Was this a reassessment because of a clinical change?", type: "yesNo" },
    ],
  },
  {
    id: "risk-stability",
    title: "Treatment Planning",
    description: "Document treatment plan work and updates.",
    questions: [
      { id: "plan_initial", label: "Did you complete an initial or restarted treatment plan?", type: "yesNo" },
      { id: "plan_newFocus", label: "Did you add a new focus area or problem?", type: "yesNo" },
      { id: "plan_goalsRevised", label: "Did you revise or refine treatment goals?", type: "yesNo" },
      { id: "plan_objectives", label: "Did you update objectives or measurable steps?", type: "yesNo", parentId: "plan_goalsRevised", showWhen: "yes" },
      { id: "plan_interventions", label: "Did you update interventions or strategies?", type: "yesNo" },
      { id: "plan_frequency", label: "Did you change frequency, modality, or level of care?", type: "yesNo" },
      { id: "plan_progress", label: "Did you review progress toward goals?", type: "yesNo" },
      { id: "plan_barriers", label: "Did you discuss barriers to progress?", type: "yesNo" },
      { id: "plan_collaboration", label: "Did the client participate in the planning work?", type: "yesNo" },
      {
        id: "planReason",
        label: "What best describes the reason for plan work?",
        type: "select",
        options: [
          { value: "none", label: "No plan work" },
          { value: "new-focus", label: "New focus or problem" },
          { value: "symptom-change", label: "Symptom or risk change" },
          { value: "scheduled-review", label: "Scheduled review" },
          { value: "external", label: "Care coordination or external change" },
          { value: "safety", label: "Safety or crisis reason" },
        ],
      },
    ],
  },
];

export function getAnswerString(answers: CodingQuestionnaireAnswers, key: string): string {
  const value = answers[key];
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  return String(value ?? "").trim();
}

export function getAnswerList(answers: CodingQuestionnaireAnswers, key: string): string[] {
  const value = answers[key];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function isYes(answers: CodingQuestionnaireAnswers, key: string): boolean {
  return getAnswerString(answers, key) === "yes";
}

export function getNumberAnswer(answers: CodingQuestionnaireAnswers, key: string): number | null {
  const raw = answers[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
