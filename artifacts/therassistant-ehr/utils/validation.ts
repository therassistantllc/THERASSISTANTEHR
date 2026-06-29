import { notImplemented } from "./_notImplemented";

/** Basic required-field validation. */
export const isRequired = (...args: unknown[]): never => notImplemented("isRequired", args);

/** Validates UUID. */
export const isValidUuid = (...args: unknown[]): never => notImplemented("isValidUuid", args);

/** Validates date. */
export const isValidDate = (...args: unknown[]): never => notImplemented("isValidDate", args);

/** Validates start/end. */
export const isValidDateRange = (...args: unknown[]): never => notImplemented("isValidDateRange", args);

/** Validates amount. */
export const isValidCurrencyAmount = (...args: unknown[]): never => notImplemented("isValidCurrencyAmount", args);

/** Checks enum value. */
export const isValidEnumValue = (...args: unknown[]): never => notImplemented("isValidEnumValue", args);

/** Generic field validation. */
export const validateRequiredFields = (...args: unknown[]): never => notImplemented("validateRequiredFields", args);

/** Confirms tenant exists/present. */
export const validateTenantId = (...args: unknown[]): never => notImplemented("validateTenantId", args);

/** Checks allowed status transitions. */
export const validateStatusTransition = (...args: unknown[]): never => notImplemented("validateStatusTransition", args);

/** Standard error object. */
export const buildValidationError = (...args: unknown[]): never => notImplemented("buildValidationError", args);

/** Groups errors by section. */
export const groupValidationErrors = (...args: unknown[]): never => notImplemented("groupValidationErrors", args);

/** Hard-stop check. */
export const hasBlockingErrors = (...args: unknown[]): never => notImplemented("hasBlockingErrors", args);

/** Warning check. */
export const hasWarnings = (...args: unknown[]): never => notImplemented("hasWarnings", args);
