import { notImplemented } from "./_notImplemented";

/** Signs outbound webhooks. */
export const buildWebhookSignature = (...args: unknown[]): never => notImplemented("buildWebhookSignature", args);

/** Validates inbound webhook. */
export const verifyWebhookSignature = (...args: unknown[]): never => notImplemented("verifyWebhookSignature", args);

/** Prevents duplicate webhook processing. */
export const dedupeWebhookEvent = (...args: unknown[]): never => notImplemented("dedupeWebhookEvent", args);

/** Standardizes external IDs. */
export const normalizeExternalId = (...args: unknown[]): never => notImplemented("normalizeExternalId", args);

/** Creates mapping key. */
export const buildExternalMappingKey = (...args: unknown[]): never => notImplemented("buildExternalMappingKey", args);

/** Converts external statuses. */
export const mapExternalStatusToInternal = (...args: unknown[]): never => notImplemented("mapExternalStatusToInternal", args);

/** Calculates retry timing. */
export const retryBackoff = (...args: unknown[]): never => notImplemented("retryBackoff", args);

/** Prevents secret leakage in logs. */
export const redactIntegrationSecrets = (...args: unknown[]): never => notImplemented("redactIntegrationSecrets", args);

/** Encrypts integration credential payload. */
export const encryptCredentialPayload = (...args: unknown[]): never => notImplemented("encryptCredentialPayload", args);

/** Decrypts integration credential payload server-side. */
export const decryptCredentialPayload = (...args: unknown[]): never => notImplemented("decryptCredentialPayload", args);
