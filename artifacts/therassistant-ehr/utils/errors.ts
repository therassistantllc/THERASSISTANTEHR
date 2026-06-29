import { notImplemented } from "./_notImplemented";

/** Standard app error object. */
export const createAppError = (...args: unknown[]): never => notImplemented("createAppError", args);

/** Converts API/Supabase error. */
export const parseApiError = (...args: unknown[]): never => notImplemented("parseApiError", args);

/** User-safe error message. */
export const getErrorMessage = (...args: unknown[]): never => notImplemented("getErrorMessage", args);

/** Determines if retry is safe. */
export const isRetryableError = (...args: unknown[]): never => notImplemented("isRetryableError", args);

/** Frontend error logging. */
export const logClientError = (...args: unknown[]): never => notImplemented("logClientError", args);

/** Backend error logging. */
export const logServerError = (...args: unknown[]): never => notImplemented("logServerError", args);

/** Removes PHI/secrets before logging. */
export const redactErrorMetadata = (...args: unknown[]): never => notImplemented("redactErrorMetadata", args);

/** Adds page/user/action context. */
export const buildErrorContext = (...args: unknown[]): never => notImplemented("buildErrorContext", args);
