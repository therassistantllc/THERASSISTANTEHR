import type { SupabaseClient } from "@supabase/supabase-js";
import { runEngine } from "./engine";
import { factLoaders } from "./facts";
import { allRules } from "./rules";
import {
  CATEGORIES,
  type Category,
  type FactContext,
  type FindingsByCategory,
  type ValidationFinding,
  type ValidationReport,
} from "./types";

function emptyByCategory(): FindingsByCategory {
  const out = {} as FindingsByCategory;
  for (const c of CATEGORIES) out[c as Category] = [];
  return out;
}

/**
 * Runs the Configuration Validation Engine for a single organization and
 * returns a categorized, severity-aware report ready for UI consumption.
 *
 * To wire the future claim scrubber, build a parallel `runClaimValidation`
 * function that reuses `runEngine` with claim-specific loaders and rules,
 * then merges its findings into the same `ValidationReport` shape.
 */
export async function runConfigValidation(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ValidationReport> {
  const ctx: FactContext = { supabase, organizationId };

  const [orgRow, findings] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle()
      .then((r) => r.data ?? null),
    runEngine(ctx, factLoaders, allRules),
  ]);

  // Sort: blocking > warning > info, then by category, then by ruleId.
  const sevOrder: Record<string, number> = { blocking: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sa = sevOrder[a.severity] ?? 99;
    const sb = sevOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.ruleId.localeCompare(b.ruleId);
  });

  const findingsByCategory = emptyByCategory();
  for (const f of findings) findingsByCategory[f.category].push(f);

  const blocking = findings.filter((f) => f.severity === "blocking").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;

  return {
    organizationId,
    organizationName: orgRow?.name ?? null,
    generatedAt: new Date().toISOString(),
    summary: {
      total: findings.length,
      blocking,
      warning,
      info,
      ready: blocking === 0,
    },
    findings,
    findingsByCategory,
  };
}

export type { ValidationFinding, ValidationReport } from "./types";
