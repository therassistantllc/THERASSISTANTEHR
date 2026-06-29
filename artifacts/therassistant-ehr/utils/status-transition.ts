import { notImplemented } from "./_notImplemented";

/** Generic transition validator. */
export const canTransitionStatus = (...args: unknown[]): never => notImplemented("canTransitionStatus", args);

/** Allowed charge status changes. */
export const getAllowedChargeTransitions = (...args: unknown[]): never => notImplemented("getAllowedChargeTransitions", args);

/** Allowed claim status changes. */
export const getAllowedClaimTransitions = (...args: unknown[]): never => notImplemented("getAllowedClaimTransitions", args);

/** Allowed payment status changes. */
export const getAllowedPaymentTransitions = (...args: unknown[]): never => notImplemented("getAllowedPaymentTransitions", args);

/** Allowed workqueue changes. */
export const getAllowedWorkqueueTransitions = (...args: unknown[]): never => notImplemented("getAllowedWorkqueueTransitions", args);

/** Suggests next claim status. */
export const getNextClaimStatus = (...args: unknown[]): never => notImplemented("getNextClaimStatus", args);

/** Suggests next charge status. */
export const getNextChargeStatus = (...args: unknown[]): never => notImplemented("getNextChargeStatus", args);

/** Determines audit requirement. */
export const requiresAuditForTransition = (...args: unknown[]): never => notImplemented("requiresAuditForTransition", args);

/** Creates status history record. */
export const buildStatusHistoryPayload = (...args: unknown[]): never => notImplemented("buildStatusHistoryPayload", args);
