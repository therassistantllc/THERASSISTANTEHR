import type { SupabaseClient } from "@supabase/supabase-js";
import { runEngine } from "../engine";
import {
  CATEGORIES,
  CLAIM_CONTENT_CATEGORIES,
  type Category,
  type FactContext,
  type FindingsByCategory,
  type RuleSpec,
  type ValidationFinding,
  type ValidationReport,
} from "../types";
import claimRules from "./rules.json";
import { buildClaimContentLoaders, loadCanonicalClaimFacts, type CanonicalClaimFacts } from "./facts";
import { loadActivePayerRules, payerRuleToFinding } from "./payerRules";

function emptyByCategory(): FindingsByCategory {
  const out = {} as FindingsByCategory;
  for (const c of CATEGORIES) out[c as Category] = [];
  return out;
}

export interface ClaimContentValidationResult {
  facts: CanonicalClaimFacts | null;
  report: ValidationReport;
}

/**
 * Runs the Claim Content Validation engine for a single claim.
 *
 * Reuses {@link runEngine} (same json-rules-engine, same FactLoader/RuleSpec
 * shapes, same ValidationFinding/ValidationReport output). Categories are
 * scoped to {@link CLAIM_CONTENT_CATEGORIES} so the result can be grouped
 * separately from system-readiness findings.
 */
export async function runClaimContentValidation(
  supabase: SupabaseClient,
  organizationId: string,
  claimId: string,
): Promise<ClaimContentValidationResult> {
  const generatedAt = new Date().toISOString();
  const facts = await loadCanonicalClaimFacts(supabase, organizationId, claimId);

  if (!facts) {
    const finding: ValidationFinding = {
      ruleId: "claim.not_found",
      category: "claimParties",
      severity: "blocking",
      message: `Claim ${claimId} was not found for this organization.`,
      fixRoute: "/billing/claims",
      whyItMatters:
        "Content validation cannot run on a claim that does not exist or is not visible to this organization.",
      resolution:
        "Verify the claim ID and that the claim has been created from the encounter before attempting to validate or submit it.",
    };
    const byCategory = emptyByCategory();
    byCategory.claimParties.push(finding);
    return {
      facts: null,
      report: {
        organizationId,
        organizationName: null,
        generatedAt,
        summary: { total: 1, blocking: 1, warning: 0, info: 0, ready: false },
        findings: [finding],
        findingsByCategory: byCategory,
      },
    };
  }

  const loaders = buildClaimContentLoaders(facts);
  const ctx: FactContext = { supabase, organizationId, claimId };

  const findings = await runEngine(ctx, loaders, claimRules as RuleSpec[]);

  // Append findings for active payer_rules (catalog of "lessons learned"
  // rules created from past CARC denials via the Denied Claims by CARC
  // workqueue). Each active rule for this claim's payer becomes one
  // finding; severity is governed by the rule's action ('warn' or 'block').
  if (facts.payerProfile?.id) {
    const activeRules = await loadActivePayerRules(supabase, organizationId, facts.payerProfile.id);
    for (const rule of activeRules) {
      findings.push(payerRuleToFinding(rule, facts.payerProfile.payer_name));
    }
  }

  // Sort and bucket.
  const sevOrder: Record<string, number> = { blocking: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sa = sevOrder[a.severity] ?? 99;
    const sb = sevOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.ruleId.localeCompare(b.ruleId);
  });

  const byCategory = emptyByCategory();
  for (const f of findings) {
    if (CLAIM_CONTENT_CATEGORIES.includes(f.category)) byCategory[f.category].push(f);
  }

  const blocking = findings.filter((f) => f.severity === "blocking").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;

  return {
    facts,
    report: {
      organizationId,
      organizationName: null,
      generatedAt,
      summary: {
        total: findings.length,
        blocking,
        warning,
        info,
        ready: blocking === 0,
      },
      findings,
      findingsByCategory: byCategory,
    },
  };
}
