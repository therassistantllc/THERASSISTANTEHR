import { notImplemented } from "./_notImplemented";

/** Calculates clinical duration from start/end. */
export const calculateSessionDuration = (...args: unknown[]): never => notImplemented("calculateSessionDuration", args);

/** Checks CPT duration requirements. */
export const validateTimeBasedService = (...args: unknown[]): never => notImplemented("validateTimeBasedService", args);

/** Checks psychotherapy goal addressed. */
export const validateNoteHasGoal = (...args: unknown[]): never => notImplemented("validateNoteHasGoal", args);

/** Checks active diagnosis. */
export const validateNoteHasDiagnosis = (...args: unknown[]): never => notImplemented("validateNoteHasDiagnosis", args);

/** Checks required signature fields. */
export const validateNoteSignature = (...args: unknown[]): never => notImplemented("validateNoteSignature", args);

/** Determines whether note can be edited. */
export const isNoteLocked = (...args: unknown[]): never => notImplemented("isNoteLocked", args);

/** Determines if amendment is allowed. */
export const canAmendNote = (...args: unknown[]): never => notImplemented("canAmendNote", args);

/** Displays note status. */
export const getNoteStatusLabel = (...args: unknown[]): never => notImplemented("getNoteStatusLabel", args);

/** Displays note type. */
export const getClinicalNoteTypeLabel = (...args: unknown[]): never => notImplemented("getClinicalNoteTypeLabel", args);

/** Pulls CPT, DOS, duration, provider, diagnosis. */
export const extractBillableDataFromNote = (...args: unknown[]): never => notImplemented("extractBillableDataFromNote", args);

/** Checks H0031/H0001/H0002/90791 documentation basics. */
export const validateAssessmentRequirements = (...args: unknown[]): never => notImplemented("validateAssessmentRequirements", args);

/** Confirms active plan/goal linkage. */
export const validateTreatmentPlanLink = (...args: unknown[]): never => notImplemented("validateTreatmentPlanLink", args);

/** Links assessment, diagnosis, plan, goal, note, claim. */
export const buildGoldenThreadSummary = (...args: unknown[]): never => notImplemented("buildGoldenThreadSummary", args);
