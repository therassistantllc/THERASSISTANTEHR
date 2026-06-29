import { notImplemented } from "./_notImplemented";

/** Cleans CPT/HCPCS codes. */
export const normalizeCptCode = (...args: unknown[]): never => notImplemented("normalizeCptCode", args);

/** Determines whether CPT requires time validation. */
export const isTimedCptCode = (...args: unknown[]): never => notImplemented("isTimedCptCode", args);

/** Converts minutes to units when needed. */
export const calculateUnitsFromMinutes = (...args: unknown[]): never => notImplemented("calculateUnitsFromMinutes", args);

/** Returns CPT/HCPCS label. */
export const getCptDescription = (...args: unknown[]): never => notImplemented("getCptDescription", args);

/** Checks CPT/modifier compatibility. */
export const validateCptModifierCombo = (...args: unknown[]): never => notImplemented("validateCptModifierCombo", args);

/** Checks CPT/POS compatibility. */
export const validateCptPosCombo = (...args: unknown[]): never => notImplemented("validateCptPosCombo", args);

/** Checks whether provider type can bill CPT. */
export const validateProviderCredentialForCpt = (...args: unknown[]): never => notImplemented("validateProviderCredentialForCpt", args);

/** Checks diagnosis format/status. */
export const validateDiagnosisForClaim = (...args: unknown[]): never => notImplemented("validateDiagnosisForClaim", args);

/** Displays ICD-10 code. */
export const formatDiagnosisCode = (...args: unknown[]): never => notImplemented("formatDiagnosisCode", args);

/** Cleans ICD-10 for matching. */
export const normalizeDiagnosisCode = (...args: unknown[]): never => notImplemented("normalizeDiagnosisCode", args);

/** Creates diagnosis pointer mapping for claim lines. */
export const buildDiagnosisPointers = (...args: unknown[]): never => notImplemented("buildDiagnosisPointers", args);

/** Optional CPT conflict helper. */
export const checkNcciConflict = (...args: unknown[]): never => notImplemented("checkNcciConflict", args);
