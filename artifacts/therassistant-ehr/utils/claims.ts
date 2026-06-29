import { notImplemented } from "./_notImplemented";

/** Displays claim status. */
export const getClaimStatusLabel = (...args: unknown[]): never => notImplemented("getClaimStatusLabel", args);

/** UI status helper. */
export const getClaimStatusColor = (...args: unknown[]): never => notImplemented("getClaimStatusColor", args);

/** Determines whether claim can be edited. */
export const isClaimEditable = (...args: unknown[]): never => notImplemented("isClaimEditable", args);

/** Checks claim is eligible for submission. */
export const canSubmitClaim = (...args: unknown[]): never => notImplemented("canSubmitClaim", args);

/** Checks ready_for_batch state. */
export const canBatchClaim = (...args: unknown[]): never => notImplemented("canBatchClaim", args);

/** Sums claim line charges. */
export const calculateClaimTotalCharges = (...args: unknown[]): never => notImplemented("calculateClaimTotalCharges", args);

/** Uses ledger/payment/adjustment data. */
export const calculateClaimOpenBalance = (...args: unknown[]): never => notImplemented("calculateClaimOpenBalance", args);

/** Days from DOS/submitted date. */
export const calculateClaimAge = (...args: unknown[]): never => notImplemented("calculateClaimAge", args);

/** 0–30, 31–60, 61–90, 91+. */
export const getClaimAgingBucket = (...args: unknown[]): never => notImplemented("getClaimAgingBucket", args);

/** Displays payer claim/control number. */
export const formatPayerClaimNumber = (...args: unknown[]): never => notImplemented("formatPayerClaimNumber", args);

/** Generates internal control number. */
export const buildClaimControlNumber = (...args: unknown[]): never => notImplemented("buildClaimControlNumber", args);

/** Creates claim client control number. */
export const buildclientControlNumber = (...args: unknown[]): never => notImplemented("buildclientControlNumber", args);

/** Checks payer, provider, diagnosis, CPT, POS, etc. */
export const validateClaimRequiredFields = (...args: unknown[]): never => notImplemented("validateClaimRequiredFields", args);

/** Converts charge to claim payload. */
export const mapChargeToClaim = (...args: unknown[]): never => notImplemented("mapChargeToClaim", args);

/** Prepares structured 837P data. */
export const mapClaimTo837PData = (...args: unknown[]): never => notImplemented("mapClaimTo837PData", args);
