import { notImplemented } from "./_notImplemented";

/** Creates grouped ledger transaction payload. */
export const buildLedgerTransaction = (...args: unknown[]): never => notImplemented("buildLedgerTransaction", args);

/** Creates individual ledger entry payload. */
export const buildLedgerEntry = (...args: unknown[]): never => notImplemented("buildLedgerEntry", args);

/** Confirms debit/credit balance if double-entry. */
export const validateLedgerTransactionBalanced = (...args: unknown[]): never => notImplemented("validateLedgerTransactionBalanced", args);

/** Calculates client balance. */
export const calculateClientBalanceFromLedger = (...args: unknown[]): never => notImplemented("calculateClientBalanceFromLedger", args);

/** Calculates claim balance. */
export const calculateClaimBalanceFromLedger = (...args: unknown[]): never => notImplemented("calculateClaimBalanceFromLedger", args);

/** Calculates payer AR. */
export const calculatePayerBalanceFromLedger = (...args: unknown[]): never => notImplemented("calculatePayerBalanceFromLedger", args);

/** Maps entry type to ledger account. */
export const getLedgerAccountForEntryType = (...args: unknown[]): never => notImplemented("getLedgerAccountForEntryType", args);

/** Prevents posting to closed period. */
export const isAccountingPeriodClosed = (...args: unknown[]): never => notImplemented("isAccountingPeriodClosed", args);

/** Finds period for posting date. */
export const getAccountingPeriodForDate = (...args: unknown[]): never => notImplemented("getAccountingPeriodForDate", args);

/** Displays ledger type. */
export const formatLedgerEntryType = (...args: unknown[]): never => notImplemented("formatLedgerEntryType", args);

/** Debit/credit display. */
export const formatLedgerSide = (...args: unknown[]): never => notImplemented("formatLedgerSide", args);

/** Links ledger entry back to payment/claim/etc. */
export const traceLedgerSource = (...args: unknown[]): never => notImplemented("traceLedgerSource", args);
