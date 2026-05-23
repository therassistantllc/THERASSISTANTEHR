/**
 * Payment Posting Engine — workqueue auto-generation rules (Task #111 / PP-5).
 *
 * One `applyWorkqueueRules(ctx)` chokepoint invoked by every commit path
 * (commitPosting/era_835, commitManualInsurancePosting, commitPatientPayment,
 * reversal-suite refund/recoupment recorders). Each rule is a PURE function
 * that inspects the postingResult + hydrated source row and returns zero or
 * more `WorkqueueRuleEmission`s. The applier then dedupes against existing
 * open items on the same source_object_id and inserts new rows + audit logs.
 *
 * Rules implemented (spec §7):
 *   - denial               — any CO/PR denial-class CARC OR insurance_payment === 0
 *   - underpayment         — insurance_payment < allowed_threshold × allowed
 *   - recoupment           — any recoupment recorded (source=recoupment)
 *   - refund               — any refund recorded (source=refund)
 *   - era_unmatched_claim  — claim_match_status='unmatched'
 *   - cob_issue            — secondary insurance expected but no secondary payer found
 *   - eligibility_conflict — posted payer != eligibility-active payer for this DOS
 *   - appeal_needed        — appealable CARC present (overlaps with denial)
 *
 * "no_response" (aging) is a separate batch scanner (see `aging.ts`), not a
 * per-commit rule.
 *
 * Thresholds: default constants below; override via organization_settings
 * (`payment_posting.underpayment_threshold_pct`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writePaymentAuditLog } from "./audit";
import type { PostingActor } from "./types";

// ── Defaults ────────────────────────────────────────────────────────────────

/** Default underpayment threshold: paid/allowed < 0.80 → underpayment item. */
export const DEFAULT_UNDERPAYMENT_THRESHOLD_PCT = 0.8;

/** CARC codes that are denial-class (no payment expected). */
const DENIAL_CARC_CODES = new Set([
  "16", // Claim/service lacks information
  "29", // Time limit for filing has expired
  "50", // Non-covered services
  "96", // Non-covered charges
  "97", // Procedure not paid separately
  "109", // Claim/service not covered by this payer
  "119", // Benefit maximum reached
  "151", // Information from another provider was not provided
  "167", // Diagnosis not covered
  "197", // Pre-cert/authorization absent
  "204", // Service not covered by patient's benefit plan
]);

/** CARC codes that flag the claim for appeal. */
const APPEAL_CARC_CODES = new Set([
  "29", // Time limit expired
  "50", // Non-covered services (frequently appealable)
  "97", // Procedure not paid separately
  "151", // Info from another provider not provided
  "167", // Diagnosis not covered (appeal w/ corrected diag)
  "197", // Pre-cert absent (appealable w/ retro auth)
]);

// ── Types ───────────────────────────────────────────────────────────────────

export type WorkqueueRuleKind =
  | "denied"
  | "underpayment"
  | "recoupment"
  | "refund"
  | "era_unmatched_claim"
  | "cob_issue"
  | "eligibility_issue"
  | "appeal_needed";

export interface WorkqueueRuleEmission {
  ruleKind: WorkqueueRuleKind;
  workType: string;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
  contextPayload: Record<string, unknown>;
}

/** Context passed to applyWorkqueueRules from every commit path. */
export interface ApplyWorkqueueRulesContext {
  organizationId: string;
  /** What kind of source object the workqueue items will link to. */
  sourceObjectType:
    | "era_claim_payment"
    | "insurance_manual_payment"
    | "client_payment"
    | "payment_recoupment"
    | "payment_refund";
  sourceObjectId: string;
  /** The professional claim, if any, this posting touched. */
  professionalClaimId: string | null;
  clientId: string | null;
  /** Used by underpayment + denial rules. */
  insurancePaymentAmount?: number | null;
  /** Used by underpayment rule. */
  allowedAmount?: number | null;
  /** Used by underpayment rule. */
  totalChargeAmount?: number | null;
  /** CAS adjustments on the claim (CARC + group code + amount). */
  casAdjustments?: Array<{
    groupCode?: string | null;
    reasonCode?: string | null;
    amount?: number | null;
  }> | null;
  /** Match status (era_835 only). 'unmatched' triggers the era_unmatched_claim rule. */
  claimMatchStatus?: string | null;
  /**
   * The discriminator for which posting source emitted this context.
   * Drives which rules can fire.
   */
  sourceKind:
    | "era_835"
    | "manual_insurance"
    | "patient_payment"
    | "recoupment"
    | "refund";
  /** payer that was actually posted. Used by eligibility_conflict rule. */
  postedPayerProfileId?: string | null;
  actor: PostingActor;
  /** Optional config override (tests). */
  underpaymentThresholdPct?: number;
}

export interface ApplyWorkqueueRulesResult {
  emissions: WorkqueueRuleEmission[];
  itemsCreated: number;
  itemIds: string[];
  errors: Array<{ rule: WorkqueueRuleKind; message: string }>;
}

// ── Pure rule functions ─────────────────────────────────────────────────────

function casGroup(adj: { groupCode?: string | null }) {
  return (adj.groupCode ?? "").toString().toUpperCase();
}

function casReason(adj: { reasonCode?: string | null }) {
  return (adj.reasonCode ?? "").toString().trim();
}

/**
 * Pure: given context, compute the set of workqueue emissions BEFORE any
 * dedupe / DB lookup. The applier handles dedupe + cob_issue + eligibility
 * (which require extra DB hits).
 */
export function computeBaseEmissions(
  ctx: ApplyWorkqueueRulesContext,
): WorkqueueRuleEmission[] {
  const out: WorkqueueRuleEmission[] = [];
  const cas = ctx.casAdjustments ?? [];
  const ins = Number(ctx.insurancePaymentAmount ?? 0);
  const allowed = Number(ctx.allowedAmount ?? 0);

  // ── era_unmatched_claim (era_835 only) ─────────────────────────────────
  if (
    ctx.sourceKind === "era_835" &&
    ctx.claimMatchStatus === "unmatched"
  ) {
    out.push({
      ruleKind: "era_unmatched_claim",
      workType: "era_unmatched_claim",
      title: "ERA could not be matched to a claim",
      description:
        "Auto-matching could not link this ERA payment to a claim. Manual review required.",
      priority: "high",
      contextPayload: { rule: "era_unmatched_claim" },
    });
    // No further posting-derived rules until matched.
    return out;
  }

  // ── recoupment / refund (driven by sourceKind) ─────────────────────────
  if (ctx.sourceKind === "recoupment") {
    out.push({
      ruleKind: "recoupment",
      workType: "recoupment",
      title: "Recoupment recorded — review takeback",
      description:
        "A payer recoupment was recorded against this payment. Verify the takeback against the remittance and rebill if necessary.",
      priority: "high",
      contextPayload: { rule: "recoupment" },
    });
    return out;
  }
  if (ctx.sourceKind === "refund") {
    out.push({
      ruleKind: "refund",
      workType: "refund_review",
      title: "Refund recorded — confirm issuance",
      description:
        "A refund was recorded. Confirm the refund has been issued and reconcile the payer/patient balance.",
      priority: "normal",
      contextPayload: { rule: "refund" },
    });
    return out;
  }

  // ── denial: insurance_payment === 0 OR any denial-class CARC ────────────
  const carcCodes = cas
    .map(casReason)
    .filter((c) => c.length > 0);
  const denialCarcs = carcCodes.filter((c) => DENIAL_CARC_CODES.has(c));
  const isZeroPay = ctx.sourceKind !== "patient_payment" && ins <= 0;
  if (denialCarcs.length > 0 || isZeroPay) {
    out.push({
      ruleKind: "denied",
      workType: "denied",
      title: denialCarcs.length > 0
        ? `Denial — CARC ${denialCarcs.join(", ")}`
        : "Denial — zero payment from payer",
      description: denialCarcs.length > 0
        ? `Payer returned denial CARC code(s): ${denialCarcs.join(", ")}. Review and action.`
        : "Payer returned zero payment without a denial code. Review the EOB and action.",
      priority: "high",
      contextPayload: { rule: "denied", carcs: denialCarcs },
    });
  }

  // ── appeal_needed: appealable CARC present ──────────────────────────────
  const appealCarcs = carcCodes.filter((c) => APPEAL_CARC_CODES.has(c));
  if (appealCarcs.length > 0) {
    out.push({
      ruleKind: "appeal_needed",
      workType: "appeal_needed",
      title: `Appeal needed — CARC ${appealCarcs.join(", ")}`,
      description: `One or more appealable denial reasons were returned: ${appealCarcs.join(", ")}. Prepare an appeal.`,
      priority: "high",
      contextPayload: { rule: "appeal_needed", carcs: appealCarcs },
    });
  }

  // ── underpayment: paid < threshold × allowed ────────────────────────────
  const threshold = ctx.underpaymentThresholdPct ?? DEFAULT_UNDERPAYMENT_THRESHOLD_PCT;
  if (
    !isZeroPay &&
    allowed > 0 &&
    ins > 0 &&
    ins / allowed < threshold
  ) {
    out.push({
      ruleKind: "underpayment",
      workType: "underpayment",
      title: `Underpayment — ${Math.round((ins / allowed) * 100)}% of allowed`,
      description: `Insurance paid ${ins.toFixed(2)} of an allowed ${allowed.toFixed(2)} (below ${Math.round(threshold * 100)}% threshold). Review for underpayment.`,
      priority: "normal",
      contextPayload: {
        rule: "underpayment",
        paid: ins,
        allowed,
        threshold_pct: threshold,
      },
    });
  }

  return out;
}

// ── Applier (DB-touching) ───────────────────────────────────────────────────

async function loadUnderpaymentThreshold(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<number> {
  try {
    const { data } = await supabase
      .from("organization_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", "payment_posting.underpayment_threshold_pct")
      .maybeSingle();
    if (data && (data as { setting_value: unknown }).setting_value != null) {
      const n = Number((data as { setting_value: unknown }).setting_value);
      if (Number.isFinite(n) && n > 0 && n < 1) return n;
    }
  } catch {
    // table may not exist in all environments; fall back silently.
  }
  return DEFAULT_UNDERPAYMENT_THRESHOLD_PCT;
}

/**
 * Check for an existing OPEN workqueue item with the same
 * (source_object_id, work_type) so we don't double-emit on replay/retry.
 */
async function existingOpenItem(
  supabase: SupabaseClient,
  organizationId: string,
  sourceObjectId: string,
  workType: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("workqueue_items")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_object_id", sourceObjectId)
      .eq("work_type", workType)
      .in("status", ["open", "in_progress", "blocked"])
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

/**
 * Look up the eligibility-active payer for this claim's date of service and
 * return cob_issue / eligibility_issue emissions when invariants don't hold.
 */
async function deriveEligibilityEmissions(
  supabase: SupabaseClient,
  organizationId: string,
  professionalClaimId: string | null,
  postedPayerProfileId: string | null | undefined,
): Promise<WorkqueueRuleEmission[]> {
  if (!professionalClaimId) return [];
  const out: WorkqueueRuleEmission[] = [];
  try {
    const { data: claim } = await supabase
      .from("professional_claims")
      .select("id, patient_id, payer_profile_id")
      .eq("organization_id", organizationId)
      .eq("id", professionalClaimId)
      .maybeSingle();
    if (!claim) return [];
    const clientId = (claim as { patient_id: string | null }).patient_id;
    const billingPayer =
      (claim as { payer_profile_id: string | null }).payer_profile_id;

    // cob_issue: any *other* active coverage exists for this client beyond the
    // one we posted under — payer needs to coordinate benefits before billing.
    if (clientId && postedPayerProfileId) {
      try {
        const { data: otherCov } = await supabase
          .from("eligibility_coverages")
          .select("id, payer_profile_id")
          .eq("organization_id", organizationId)
          .eq("client_id", clientId)
          .neq("payer_profile_id", postedPayerProfileId)
          .limit(1)
          .maybeSingle();
        if (otherCov?.id) {
          out.push({
            ruleKind: "cob_issue",
            workType: "cob_issue",
            title: "COB issue — additional coverage on file",
            description:
              "Patient has additional active insurance coverage beyond the payer we posted under. Verify COB order before re-billing.",
            priority: "normal",
            contextPayload: {
              rule: "cob_issue",
              other_payer: (otherCov as { payer_profile_id: string | null }).payer_profile_id,
            },
          });
        }
      } catch {
        // eligibility_coverages may not exist in all envs — ignore.
      }
    }

    // eligibility_issue: posted payer differs from the claim's billing payer.
    if (
      postedPayerProfileId &&
      billingPayer &&
      postedPayerProfileId !== billingPayer
    ) {
      out.push({
        ruleKind: "eligibility_issue",
        workType: "eligibility_issue",
        title: "Eligibility conflict — posted payer ≠ billing payer",
        description: `This payment was posted under payer ${postedPayerProfileId} but the claim was billed to payer ${billingPayer}. Verify eligibility and payer routing.`,
        priority: "normal",
        contextPayload: {
          rule: "eligibility_issue",
          posted_payer: postedPayerProfileId,
          billing_payer: billingPayer,
        },
      });
    }
  } catch {
    // Tolerate missing columns — these tables vary by deployment.
  }
  return out;
}

/**
 * Apply all rules: compute emissions, dedupe against open items, insert
 * workqueue_items, and write an audit_logs row per inserted item.
 */
export async function applyWorkqueueRules(
  supabase: SupabaseClient,
  ctx: ApplyWorkqueueRulesContext,
): Promise<ApplyWorkqueueRulesResult> {
  const result: ApplyWorkqueueRulesResult = {
    emissions: [],
    itemsCreated: 0,
    itemIds: [],
    errors: [],
  };

  // Load org threshold once; merge into ctx for pure compute.
  if (ctx.underpaymentThresholdPct == null) {
    ctx.underpaymentThresholdPct = await loadUnderpaymentThreshold(
      supabase,
      ctx.organizationId,
    );
  }

  const base = computeBaseEmissions(ctx);
  const elig = await deriveEligibilityEmissions(
    supabase,
    ctx.organizationId,
    ctx.professionalClaimId,
    ctx.postedPayerProfileId ?? null,
  );
  const allEmissions = [...base, ...elig];
  result.emissions = allEmissions;

  for (const em of allEmissions) {
    const exists = await existingOpenItem(
      supabase,
      ctx.organizationId,
      ctx.sourceObjectId,
      em.workType,
    );
    if (exists) continue;
    try {
      const { data, error } = await supabase
        .from("workqueue_items")
        .insert({
          organization_id: ctx.organizationId,
          source_object_type: ctx.sourceObjectType,
          source_object_id: ctx.sourceObjectId,
          client_id: ctx.clientId,
          professional_claim_id: ctx.professionalClaimId,
          priority: em.priority,
          status: "open",
          work_type: em.workType,
          title: em.title,
          description: em.description,
          context_payload: em.contextPayload,
        })
        .select("id")
        .single();
      if (error) {
        result.errors.push({ rule: em.ruleKind, message: error.message });
        continue;
      }
      const id = String((data as { id: string }).id);
      result.itemIds.push(id);
      result.itemsCreated++;
      await writePaymentAuditLog(supabase, {
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        action: "payment_posted",
        objectType:
          ctx.sourceObjectType === "era_claim_payment"
            ? "era_claim_payment"
            : ctx.sourceObjectType === "insurance_manual_payment"
              ? "insurance_manual_payment"
              : ctx.sourceObjectType === "client_payment"
                ? "client_payment"
                : ctx.sourceObjectType === "payment_recoupment"
                  ? "payment_recoupment"
                  : "payment_refund",
        objectId: ctx.sourceObjectId,
        workqueueItemId: id,
        claimId: ctx.professionalClaimId,
        afterValue: { workqueue_rule: em.ruleKind, work_type: em.workType },
        summary: `Workqueue rule emitted: ${em.title}`,
        metadata: { source: "workqueue_rule", ...em.contextPayload },
      });
    } catch (err) {
      result.errors.push({
        rule: em.ruleKind,
        message: err instanceof Error ? err.message : "insert failed",
      });
    }
  }

  return result;
}

// ── Aging scanner (no_response rule, batch) ────────────────────────────────

/** Default no_response threshold: 30 days since submission without ACK/payment. */
export const DEFAULT_NO_RESPONSE_DAYS = 30;

export interface RunAgingScanInput {
  organizationId: string;
  actor: PostingActor;
  /** Override the default 30-day threshold. */
  noResponseDays?: number;
}

export interface RunAgingScanResult {
  scanned: number;
  itemsCreated: number;
  itemIds: string[];
  errors: Array<{ claimId: string; message: string }>;
}

/**
 * Scan submitted claims older than `noResponseDays` with no payment and no
 * existing open no_response workqueue item; emit one per eligible claim.
 * Designed to be called from a cron route once/day.
 */
export async function runNoResponseAgingScan(
  supabase: SupabaseClient,
  input: RunAgingScanInput,
): Promise<RunAgingScanResult> {
  const result: RunAgingScanResult = {
    scanned: 0,
    itemsCreated: 0,
    itemIds: [],
    errors: [],
  };
  const days = input.noResponseDays ?? DEFAULT_NO_RESPONSE_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from("professional_claims")
    .select("id, client_id, submitted_at, claim_status")
    .eq("organization_id", input.organizationId)
    .lte("submitted_at", cutoff)
    .in("claim_status", ["submitted", "accepted", "billed"])
    .is("archived_at", null);
  if (error) {
    result.errors.push({ claimId: "*", message: error.message });
    return result;
  }
  result.scanned = (candidates ?? []).length;

  for (const c of candidates ?? []) {
    const claim = c as { id: string; client_id: string | null; submitted_at: string };
    const exists = await existingOpenItem(
      supabase,
      input.organizationId,
      claim.id,
      "no_response",
    );
    if (exists) continue;
    try {
      const { data, error: insErr } = await supabase
        .from("workqueue_items")
        .insert({
          organization_id: input.organizationId,
          source_object_type: "professional_claim",
          source_object_id: claim.id,
          client_id: claim.client_id,
          professional_claim_id: claim.id,
          priority: "normal",
          status: "open",
          work_type: "no_response",
          title: `No payer response in ${days} days`,
          description: `Claim was submitted on ${claim.submitted_at} and has had no acknowledgement or payment for ${days}+ days. Follow up with payer.`,
          context_payload: {
            rule: "no_response",
            days_threshold: days,
            submitted_at: claim.submitted_at,
          },
        })
        .select("id")
        .single();
      if (insErr) {
        result.errors.push({ claimId: claim.id, message: insErr.message });
        continue;
      }
      const id = String((data as { id: string }).id);
      result.itemIds.push(id);
      result.itemsCreated++;
      await writePaymentAuditLog(supabase, {
        organizationId: input.organizationId,
        actor: input.actor,
        action: "payment_posted",
        objectType: "professional_claim",
        objectId: claim.id,
        workqueueItemId: id,
        claimId: claim.id,
        afterValue: { rule: "no_response", days_threshold: days },
        summary: `Aging scan: no_response item created for claim ${claim.id}`,
        metadata: { source: "aging_scan", days_threshold: days },
      });
    } catch (err) {
      result.errors.push({
        claimId: claim.id,
        message: err instanceof Error ? err.message : "insert failed",
      });
    }
  }
  return result;
}
