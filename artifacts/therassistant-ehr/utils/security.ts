import { notImplemented } from "./_notImplemented";

/** Masks SSN if ever stored. */
export const maskSsn = (...args: unknown[]): never => notImplemented("maskSsn", args);

/** Masks insurance member ID. */
export const maskMemberId = (...args: unknown[]): never => notImplemented("maskMemberId", args);

/** Masks phone. */
export const maskPhone = (...args: unknown[]): never => notImplemented("maskPhone", args);

/** Masks email. */
export const maskEmail = (...args: unknown[]): never => notImplemented("maskEmail", args);

/** Removes PHI from logs/errors. */
export const redactPhi = (...args: unknown[]): never => notImplemented("redactPhi", args);

/** Prevents leaking backend details. */
export const sanitizeErrorForClient = (...args: unknown[]): never => notImplemented("sanitizeErrorForClient", args);

/** Removes secrets/unsafe payloads. */
export const sanitizeAuditMetadata = (...args: unknown[]): never => notImplemented("sanitizeAuditMetadata", args);

/** Confirms record belongs to tenant. */
export const hasTenantScope = (...args: unknown[]): never => notImplemented("hasTenantScope", args);

/** Client-side permission helper. */
export const canAccessRecord = (...args: unknown[]): never => notImplemented("canAccessRecord", args);

/** Removes fields user cannot edit. */
export const stripUnauthorizedFields = (...args: unknown[]): never => notImplemented("stripUnauthorizedFields", args);
