import { Engine, type RuleProperties } from "json-rules-engine";
import type { Category, FactContext, FactLoader, RuleSpec, ValidationFinding } from "./types";

/** Map fact loader name -> validation category, for synthesizing a
 *  blocking "data unavailable" finding if a loader throws. Keeping this
 *  alongside the engine avoids duplicating the mapping at the call site. */
const LOADER_CATEGORY: Record<string, Category> = {
  // System readiness loaders
  organization: "organization",
  providers: "providers",
  locations: "locations",
  payers: "payers",
  clearinghouse: "clearinghouse",
  feeSchedules: "feeSchedules",
  billingDefaults: "billingDefaults",
  // Claim content loaders (lib/validation/claim/facts.ts)
  claim: "claimParties",
  serviceLines: "claimServiceLines",
  claimDates: "claimDates",
  parties: "claimParties",
  telehealth: "claimTelehealth",
  authorization: "claimAuthorization",
};

/**
 * Compiles a rule registry + a set of fact loaders into a json-rules-engine
 * Engine bound to one validation run. Each loader is registered as a dynamic
 * fact keyed by `loader.name`; the engine caches each fact value within a
 * single `run()` so loaders execute at most once per evaluation.
 *
 * Each rule's `event.params` carries the user-facing metadata. On `success`
 * (i.e. when the rule's violation conditions match), a `ValidationFinding`
 * is appended to the returned list.
 *
 * The engine is intentionally generic: to add a future claim-scrubber pass,
 * call this with a different rule set and fact-loader set (e.g. per-claim
 * facts) without changing this module.
 */
export async function runEngine(
  ctx: FactContext,
  loaders: FactLoader[],
  rules: RuleSpec[],
): Promise<ValidationFinding[]> {
  const engine = new Engine([], { allowUndefinedFacts: true });
  const loaderErrors = new Map<string, string>();

  for (const loader of loaders) {
    engine.addFact(loader.name, async () => {
      try {
        return await loader.load(ctx);
      } catch (err) {
        // Loader failures must not silently coerce to "all passing".
        // Record the error and return an empty object so rules referencing
        // missing paths simply don't fire; we'll emit a synthetic blocking
        // finding for each errored loader after the run.
        loaderErrors.set(loader.name, err instanceof Error ? err.message : String(err));
        return {};
      }
    });
  }

  for (const spec of rules) {
    const rule: RuleProperties = {
      conditions: spec.conditions as RuleProperties["conditions"],
      event: {
        type: spec.id,
        params: {
          category: spec.category,
          severity: spec.severity,
          message: spec.message,
          fixRoute: spec.fixRoute,
          whyItMatters: spec.whyItMatters,
          resolution: spec.resolution,
        },
      },
    };
    engine.addRule(rule);
  }

  const findings: ValidationFinding[] = [];
  engine.on("success", (event, almanac) => {
    const params = event.params ?? {};
    findings.push({
      ruleId: event.type,
      category: params.category,
      severity: params.severity,
      message: params.message,
      fixRoute: params.fixRoute,
      whyItMatters: params.whyItMatters,
      resolution: params.resolution,
    });
    // `almanac` is part of the json-rules-engine API; we don't read it here
    // but reference it to keep types narrow for future evidence wiring.
    void almanac;
  });

  await engine.run();

  // Surface loader failures as blocking findings rather than silently
  // letting their absence look like "all passing".
  for (const [loaderName, errMsg] of loaderErrors) {
    findings.push({
      ruleId: `engine.fact_unavailable.${loaderName}`,
      category: LOADER_CATEGORY[loaderName] ?? "organization",
      severity: "blocking",
      message: `Could not load configuration data for "${loaderName}".`,
      fixRoute: "/settings",
      whyItMatters:
        "The validation engine could not read this configuration domain, so its rules were skipped. " +
        "Treat the engine result as incomplete until the underlying data source is available.",
      resolution:
        "Check database connectivity, table permissions, and recent schema changes. Re-run validation after the underlying error is resolved.",
      evidence: { loader: loaderName, error: errMsg },
    });
  }

  return findings;
}
