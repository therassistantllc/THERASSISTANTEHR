import { notImplemented } from "./_notImplemented";

/** Fake client record. */
export const mockClient = (...args: unknown[]): never => notImplemented("mockClient", args);

/** Fake appointment. */
export const mockAppointment = (...args: unknown[]): never => notImplemented("mockAppointment", args);

/** Fake note. */
export const mockClinicalNote = (...args: unknown[]): never => notImplemented("mockClinicalNote", args);

/** Fake charge. */
export const mockCharge = (...args: unknown[]): never => notImplemented("mockCharge", args);

/** Fake claim. */
export const mockClaim = (...args: unknown[]): never => notImplemented("mockClaim", args);

/** Fake payment. */
export const mockPayment = (...args: unknown[]): never => notImplemented("mockPayment", args);

/** Fake ledger entry. */
export const mockLedgerEntry = (...args: unknown[]): never => notImplemented("mockLedgerEntry", args);

/** Fake workqueue task. */
export const mockWorkqueueItem = (...args: unknown[]): never => notImplemented("mockWorkqueueItem", args);

/** Creates test tenant context. */
export const buildTestTenant = (...args: unknown[]): never => notImplemented("buildTestTenant", args);

/** Creates user with permissions. */
export const buildTestUserWithRole = (...args: unknown[]): never => notImplemented("buildTestUserWithRole", args);

/** Test helper. */
export const assertLedgerBalanced = (...args: unknown[]): never => notImplemented("assertLedgerBalanced", args);

/** Test helper. */
export const assertAuditLogWritten = (...args: unknown[]): never => notImplemented("assertAuditLogWritten", args);

/** Test helper. */
export const assertWorkqueueCreated = (...args: unknown[]): never => notImplemented("assertWorkqueueCreated", args);
