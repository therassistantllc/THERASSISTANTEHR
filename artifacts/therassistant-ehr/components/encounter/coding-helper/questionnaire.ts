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
      { id: "screenScored", label: "Did you record the score?", type: "yesNo" },
      { id: "screenInterpreted", label: "Did you discuss what the score means?", type: "yesNo" },
    ],
  },
  {
    id: "presenting-issues",
    title: "Presenting Issues",
    description: "Preserve the old intake path around symptoms, history, and substance use review.",
    questions: [
      { id: "newConcerns", label: "Did you identify any new concerns or symptoms?", type: "yesNo" },
      { id: "currentExperience", label: "Did you ask what they are experiencing right now?", type: "yesNo" },
      { id: "symptomProgression", label: "Did you assess whether symptoms are improving, worsening, or staying the same?", type: "yesNo" },
      { id: "sessionChanges", label: "Did you review changes since the last session?", type: "yesNo" },
      { id: "severityExploration", label: "Did you explore severity or intensity?", type: "yesNo" },
      { id: "onsetHistory", label: "Did you ask when this started or what has been happening?", type: "yesNo" },
      { id: "strengthsDiscussion", label: "Did you discuss strengths or coping resources?", type: "yesNo" },
      { id: "substanceUse", label: "Did you ask about alcohol or drug use?", type: "yesNo" },
      { id: "cravingsAssessment", label: "Did you assess cravings, urges, or relapse risk?", type: "yesNo" },
      { id: "triggersIdentification", label: "Did you identify triggers related to substance use?", type: "yesNo" },
      { id: "treatmentHistory", label: "Did you review treatment or recovery history?", type: "yesNo" },
      { id: "asamFactors", label: "Did you review ASAM or level-of-care factors?", type: "yesNo" },
    ],
  },
  {
    id: "functional-impact",
    title: "Functional Impact",
    description: "Mirror the older functional impact and diagnostic clarification prompts.",
    questions: [
      { id: "mh_social", label: "Did you discuss relationship or social impact?", type: "yesNo" },
      { id: "mh_work", label: "Did you discuss work or school impact?", type: "yesNo" },
      { id: "mh_adl", label: "Did you discuss daily life or self-care impact?", type: "yesNo" },
      { id: "mh_cognitive", label: "Did you discuss thinking, focus, or decision-making impact?", type: "yesNo" },
      { id: "mh_risk", label: "Did you assess risk or safety concerns?", type: "yesNo" },
      { id: "mh_dxClarified", label: "Did you clarify diagnostic fit or differential diagnosis?", type: "yesNo" },
      { id: "mh_dxRevised", label: "Did the diagnosis change?", type: "yesNo" },
      { id: "mh_reassessment", label: "Was this a reassessment because of a clinical change?", type: "yesNo" },
    ],
  },
  {
    id: "risk-stability",
    title: "Risk and Stability",
    description: "Keep the treatment-planning branch that the simplified panel dropped.",
    questions: [
      { id: "plan_initial", label: "Did you complete an initial or restarted treatment plan?", type: "yesNo" },
      { id: "plan_newFocus", label: "Did you add a new focus area or problem?", type: "yesNo" },
      { id: "plan_goalsRevised", label: "Did you revise or refine treatment goals?", type: "yesNo" },
      { id: "plan_objectives", label: "Did you update objectives or measurable steps?", type: "yesNo" },
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
  {
    id: "care-coordination",
    title: "Care Coordination",
    description: "Port the old crisis and case-management branch into the native panel.",
    questions: [
      { id: "crisisStabilization", label: "Did you perform crisis stabilization or de-escalation?", type: "yesNo" },
      { id: "careCoordination", label: "Did you coordinate care or make referrals to other providers or agencies?", type: "yesNo" },
      { id: "communityResourcesLinked", label: "Did you link the client to community resources?", type: "yesNo" },
      { id: "benefitNavigation", label: "Did you assist with benefits or insurance navigation?", type: "yesNo" },
      { id: "collateralContact", label: "Did you make collateral contacts?", type: "yesNo" },
      { id: "referralsMade", label: "Did you submit or document specific referrals?", type: "yesNo" },
      { id: "crisisSafetyPlan", label: "Did you develop or update a safety or crisis plan?", type: "yesNo" },
    ],
  },
  {
    id: "peer-support",
    title: "Peer Support",
    description: "Retain the peer support questionnaire path instead of inferring it from keywords.",
    questions: [
      { id: "livedExpertiseShared", label: "Did you share lived experience to support recovery?", type: "yesNo" },
      { id: "peerRecoveryPlanning", label: "Did you work on recovery planning or WRAP goals?", type: "yesNo" },
      { id: "peerSystemNavigation", label: "Did you help the client navigate treatment systems or resources?", type: "yesNo" },
      { id: "peerSkillBuilding", label: "Did you engage in wellness or skill-building activities together?", type: "yesNo" },
      { id: "peerMutualSupport", label: "Did you provide mutual support, encouragement, or mentoring?", type: "yesNo" },
      { id: "recoveryMilestonesReviewed", label: "Did you review recovery milestones, setbacks, or progress?", type: "yesNo" },
    ],
  },
  {
    id: "psychoeducation",
    title: "Psychoeducation",
    description: "Preserve structured psychoeducation prompts as first-class inputs.",
    questions: [
      { id: "diagnosisEducation", label: "Did you provide education about diagnosis or symptoms?", type: "yesNo" },
      { id: "symptomManagementEdu", label: "Did you teach symptom management strategies?", type: "yesNo" },
      { id: "copingSkillsEdu", label: "Did you teach coping skills or related concepts?", type: "yesNo" },
      { id: "treatmentRationaleEdu", label: "Did you explain treatment rationale or why interventions were used?", type: "yesNo" },
      { id: "medicationEducationEdu", label: "Did you provide medication education?", type: "yesNo" },
      { id: "familyEducationEdu", label: "Did you provide psychoeducation to family or supports?", type: "yesNo" },
      { id: "relapsePrevEdu", label: "Did you address relapse prevention in an educational framework?", type: "yesNo" },
    ],
  },
  {
    id: "screening-documentation",
    title: "Screening Documentation",
    description: "Keep the old detailed screening fields so H0002 logic is not reduced to heuristics.",
    questions: [
      { id: "screenTools", label: "Which screening tools were used?", type: "multiselect", options: SCREENING_TOOL_OPTIONS },
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
      },
      { id: "screenScores", label: "Document key scores or findings", type: "textarea", placeholder: "Example: PHQ-9 16, GAD-7 12, discussed with client and used for referral." },
    ],
  },
  {
    id: "diagnosis-context",
    title: "Diagnosis and Context",
    description: "Capture the contextual inputs the old helper used to support coding narratives.",
    questions: [
      { id: "contextShort", label: "Relevant clinical or psychosocial context", type: "textarea", placeholder: "Recent stressors, relapse risks, diagnostic context, or care barriers." },
      { id: "followUp", label: "Follow-up actions or next steps", type: "textarea", placeholder: "Referrals, monitoring, safety planning, scheduling, or continued interventions." },
    ],
  },
  {
    id: "supporting-details",
    title: "Supporting Details",
    description: "Hold the extra supporting narrative that the report builder can surface directly.",
    questions: [
      { id: "supportingDetails", label: "Additional supporting details", type: "textarea", placeholder: "Anything that would strengthen medical necessity or documentation support." },
    ],
  },
  {
    id: "guidance",
    title: "Guidance",
    description: "Use this field to capture any constraints or coding guidance you want reflected in the report.",
    questions: [
      { id: "guidanceNotes", label: "Guidance or caution notes", type: "textarea", placeholder: "Optional billing cautions, documentation reminders, or supervisor guidance." },
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