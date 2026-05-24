/**
 * Rank ERA payment candidates as the likely offset source for a take-back.
 *
 * The recoupments worklist already auto-seeds `offset_era_claim_payment_id`
 * when the take-back was found in the same ERA batch as a positive-pay row
 * (PLB WO/FB/J1/72 or a negative CLP). For take-backs whose offsetting check
 * arrived in a later ERA, the biller has to pick the offset manually. This
 * helper scores the candidate ERA payments so the picker can pre-select and
 * flag the strongest match.
 *
 * Signals, in priority order:
 *   1. The recoupment already carries an auto-detected offset id.
 *   2. The recoupment's PLB reference identifier (parsed from `reason`)
 *      matches the candidate's TRN02 check/EFT number.
 *   3. Same payer (profile id, falling back to case-insensitive name).
 *   4. Payment amount equals or exceeds the take-back amount.
 *   5. Payment posted close to the take-back notice date.
 */

export interface SuggestionRowInput {
  recoupment_amount: number;
  reason: string | null;
  reason_code: string | null;
  payer_profile_id: string | null;
  payer_name: string | null;
  notice_date: string | null;
  offset_era_claim_payment_id: string | null;
}

export interface SuggestionPaymentInput {
  id: string;
  paymentAmount: number;
  checkNumber: string | null;
  importedAt: string | null;
  createdAt: string;
  payer: { id: string | null; name: string | null };
}

export interface PaymentSuggestion {
  score: number;
  reason: string;
}

export interface SuggestOffsetResult {
  /** Best candidate id, or null when no candidate clears the suggest threshold. */
  bestId: string | null;
  /** True when the best candidate is strong enough to pre-select. */
  shouldPreselect: boolean;
  /** Per-payment score + headline reason. Only includes scored candidates. */
  byId: Map<string, PaymentSuggestion>;
}

/** Minimum score to flag a row as "Suggested match". */
export const SUGGEST_THRESHOLD = 250;
/** Minimum score to pre-select the row automatically (advisory only). */
export const PRESELECT_THRESHOLD = 500;

/**
 * Pull the PLB reference identifier out of the recoupment's reason text.
 *
 * The take-back detector formats the reason as
 * `Provider-level take-back (PLB WO ref 1234)`, so we look for `ref <token>`
 * up to the next whitespace or closing paren.
 */
export function extractPlbReference(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const m = reason.match(/\bref\s+([^\s)]+)/i);
  return m ? m[1].trim() || null : null;
}

function samePayer(
  row: Pick<SuggestionRowInput, "payer_profile_id" | "payer_name">,
  payment: SuggestionPaymentInput,
): boolean {
  if (row.payer_profile_id && payment.payer.id) {
    return payment.payer.id === row.payer_profile_id;
  }
  if (row.payer_name && payment.payer.name) {
    return payment.payer.name.trim().toLowerCase() === row.payer_name.trim().toLowerCase();
  }
  return false;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / (1000 * 60 * 60 * 24);
}

export function scoreOffsetCandidate(
  row: SuggestionRowInput,
  payment: SuggestionPaymentInput,
): PaymentSuggestion | null {
  let score = 0;
  const reasons: string[] = [];

  if (row.offset_era_claim_payment_id && payment.id === row.offset_era_claim_payment_id) {
    score += 1000;
    const code = row.reason_code ? ` (PLB ${row.reason_code})` : "";
    reasons.push(`Auto-matched from ERA take-back segment${code}`);
  }

  const plbRef = extractPlbReference(row.reason);
  if (plbRef && payment.checkNumber && payment.checkNumber.trim() === plbRef.trim()) {
    score += 500;
    reasons.push(`PLB reference matches check #${payment.checkNumber}`);
  }

  const payerMatches = samePayer(row, payment);
  if (payerMatches) score += 200;

  const takeback = Math.abs(Number(row.recoupment_amount) || 0);
  const paid = Math.abs(Number(payment.paymentAmount) || 0);
  if (takeback > 0) {
    if (Math.abs(takeback - paid) < 0.01) {
      score += 150;
      reasons.push("Payment amount matches take-back exactly");
    } else if (paid >= takeback) {
      score += 60;
    }
  }

  const days = daysBetween(
    row.notice_date,
    payment.importedAt ?? payment.createdAt ?? null,
  );
  if (days != null) {
    if (days <= 7) {
      score += 100;
      if (payerMatches && reasons.length === 0) {
        reasons.push(`Posted within ${Math.max(1, Math.round(days))}d of notice`);
      }
    } else if (days <= 30) {
      score += 50;
    } else if (days <= 90) {
      score += 15;
    }
  }

  if (score === 0) return null;
  const headline =
    reasons[0] ??
    (payerMatches ? "Same payer" : "Possible match");
  return { score, reason: headline };
}

export function suggestOffsetPayment(
  row: SuggestionRowInput,
  payments: SuggestionPaymentInput[],
): SuggestOffsetResult {
  const byId = new Map<string, PaymentSuggestion>();
  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const p of payments) {
    const s = scoreOffsetCandidate(row, p);
    if (!s) continue;
    byId.set(p.id, s);
    if (s.score > bestScore) {
      bestScore = s.score;
      bestId = p.id;
    }
  }

  if (bestScore < SUGGEST_THRESHOLD) {
    return { bestId: null, shouldPreselect: false, byId };
  }

  return {
    bestId,
    shouldPreselect: bestScore >= PRESELECT_THRESHOLD,
    byId,
  };
}
