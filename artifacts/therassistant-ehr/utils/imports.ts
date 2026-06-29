import { notImplemented } from "./_notImplemented";

/** Reads CSV input. */
export const parseCsvFile = (...args: unknown[]): never => notImplemented("parseCsvFile", args);

/** Reads Excel import. */
export const parseExcelFile = (...args: unknown[]): never => notImplemented("parseExcelFile", args);

/** Cleans column names. */
export const normalizeImportHeaders = (...args: unknown[]): never => notImplemented("normalizeImportHeaders", args);

/** Converts row to client/claim/payment/etc. */
export const mapImportRowToEntity = (...args: unknown[]): never => notImplemented("mapImportRowToEntity", args);

/** Finds row errors/warnings. */
export const validateImportRow = (...args: unknown[]): never => notImplemented("validateImportRow", args);

/** Client/claim/payment duplicate detection. */
export const detectImportDuplicates = (...args: unknown[]): never => notImplemented("detectImportDuplicates", args);

/** Human-readable import errors. */
export const formatImportError = (...args: unknown[]): never => notImplemented("formatImportError", args);

/** Creates external ID link. */
export const buildLegacyRecordLink = (...args: unknown[]): never => notImplemented("buildLegacyRecordLink", args);

/** Shows what rollback would affect. */
export const rollbackImportPreview = (...args: unknown[]): never => notImplemented("rollbackImportPreview", args);

/** Removes invalid characters. */
export const sanitizeImportedText = (...args: unknown[]): never => notImplemented("sanitizeImportedText", args);

/** Converts date strings. */
export const coerceImportDate = (...args: unknown[]): never => notImplemented("coerceImportDate", args);

/** Converts money strings. */
export const coerceImportCurrency = (...args: unknown[]): never => notImplemented("coerceImportCurrency", args);
