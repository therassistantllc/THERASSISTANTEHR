import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { runConfigValidation } from "./runValidation";
import type { ValidationFinding, ValidationReport } from "./types";

export type GateResult =
  | { ok: true; report: ValidationReport }
  | {
      ok: false;
      reason: "missing_organization_id" | "database_unavailable" | "blocking_findings" | "engine_error";
      message: string;
      report?: ValidationReport;
      blockingFindings?: ValidationFinding[];
      findingsByCategory?: ValidationReport["findingsByCategory"];
      summary?: ValidationReport["summary"];
    };

/**
 * Pre-flight check for any code path that creates, generates, or transmits a
 * claim. Runs the Configuration Validation Engine for the given organization
 * and blocks if any rule with severity "blocking" matched.
 *
 * Use {@link gateResponse} to convert a non-ok result into a NextResponse
 * with HTTP 422 and the standard gate body.
 */
export async function assertClaimSubmissionReady(
  organizationId: string | null | undefined,
): Promise<GateResult> {
  if (!organizationId) {
    return {
      ok: false,
      reason: "missing_organization_id",
      message: "organizationId is required to run the claim submission readiness gate.",
    };
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      reason: "database_unavailable",
      message: "Database connection not available; cannot evaluate claim submission readiness.",
    };
  }

  let report: ValidationReport;
  try {
    report = await runConfigValidation(supabase, organizationId);
  } catch (err) {
    return {
      ok: false,
      reason: "engine_error",
      message: err instanceof Error ? err.message : "Validation engine failed.",
    };
  }

  if (report.summary.blocking > 0) {
    const blockingFindings = report.findings.filter((f) => f.severity === "blocking");
    return {
      ok: false,
      reason: "blocking_findings",
      message:
        `Claim submission blocked by ${blockingFindings.length} configuration finding` +
        `${blockingFindings.length === 1 ? "" : "s"}. ` +
        "Resolve every blocking item in System Readiness before generating or transmitting claims.",
      report,
      blockingFindings,
      findingsByCategory: report.findingsByCategory,
      summary: report.summary,
    };
  }

  return { ok: true, report };
}

/**
 * Build the standard NextResponse for a failed gate result. Returns null when
 * the gate passed (callers should continue normally in that case).
 */
export function gateResponse(gate: GateResult): NextResponse | null {
  if (gate.ok) return null;

  const status =
    gate.reason === "missing_organization_id"
      ? 400
      : gate.reason === "database_unavailable" || gate.reason === "engine_error"
        ? 503
        : 422; // blocking_findings

  return NextResponse.json(
    {
      success: false,
      error: gate.message,
      gate: {
        blocked: true,
        reason: gate.reason,
        summary: gate.summary,
        blockingFindings: gate.blockingFindings,
        findingsByCategory: gate.findingsByCategory,
        fixRoute: "/settings/system-readiness",
      },
    },
    { status },
  );
}
