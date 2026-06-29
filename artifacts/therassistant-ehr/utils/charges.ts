import { notImplemented } from "./_notImplemented";

/** Displays charge status. */
export const getChargeStatusLabel = (...args: unknown[]): never => notImplemented("getChargeStatusLabel", args);

/** Checks if charge can still be changed. */
export const isChargeEditable = (...args: unknown[]): never => notImplemented("isChargeEditable", args);

/** Checks readiness for claim creation. */
export const canCreateClaimFromCharge = (...args: unknown[]): never => notImplemented("canCreateClaimFromCharge", args);

/** Returns missing/invalid data. */
export const getChargeValidationErrors = (...args: unknown[]): never => notImplemented("getChargeValidationErrors", args);

/** Groups charges for batch claim creation. */
export const groupChargesByClient = (...args: unknown[]): never => notImplemented("groupChargesByClient", args);

/** Groups charges by payer. */
export const groupChargesByPayer = (...args: unknown[]): never => notImplemented("groupChargesByPayer", args);

/** Groups charges by rendering provider. */
export const groupChargesByProvider = (...args: unknown[]): never => notImplemented("groupChargesByProvider", args);

/** Calculates charge from fee schedule. */
export const calculateChargeAmount = (...args: unknown[]): never => notImplemented("calculateChargeAmount", args);

/** Sums charge lines. */
export const calculateTotalCharges = (...args: unknown[]): never => notImplemented("calculateTotalCharges", args);

/** Checks duplicate appointment/service/date. */
export const isDuplicateCharge = (...args: unknown[]): never => notImplemented("isDuplicateCharge", args);

/** Converts appointment/service to charge payload. */
export const mapAppointmentToCharge = (...args: unknown[]): never => notImplemented("mapAppointmentToCharge", args);

/** Converts signed note to charge payload. */
export const mapNoteToCharge = (...args: unknown[]): never => notImplemented("mapNoteToCharge", args);
