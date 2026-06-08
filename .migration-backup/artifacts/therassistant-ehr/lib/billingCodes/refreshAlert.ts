/**
 * Side-effecting alert delivery for the scheduled billing-code refresh.
 *
 * Two channels, both best-effort:
 *   - Email via Resend to BILLING_CODES_REFRESH_ALERT_EMAIL (comma-separated).
 *   - One open workqueue item per organization (work_type =
 *     'billing_code_refresh_failure'), deduped by the existing open-item
 *     unique index (organization_id, source_object_type, source_object_id,
 *     work_type) WHERE status='open' AND archived_at IS NULL.
 *
 * Channels are independent: a Resend failure must not suppress workqueue
 * creation, and vice versa. The script logs both outcomes and exits non-zero
 * if *neither* channel succeeded (so the surrounding cron failure surfaces
 * the silent-alert case too).
 */

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  summarizeAlertReasons,
  type AlertReason,
  type PerSystemResult,
} from "./refreshAlertLogic";

export interface DispatchAlertInput {
  reasons: AlertReason[];
  results: PerSystemResult[];
  runStartedAt: Date;
  runFinishedAt: Date;
}

export interface DispatchAlertOutcome {
  emailed: { ok: boolean; recipients: string[]; error?: string };
  workqueue: { ok: boolean; created: number; error?: string };
}

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseRecipients(): string[] {
  const raw =
    process.env.BILLING_CODES_REFRESH_ALERT_EMAIL ||
    process.env.OPS_ALERT_EMAIL ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderEmail(input: DispatchAlertInput): { subject: string; text: string } {
  const headline = summarizeAlertReasons(input.reasons);
  const lines: string[] = [];
  lines.push("Scheduled billing-code refresh needs attention.");
  lines.push("");
  lines.push(`Started:  ${input.runStartedAt.toISOString()}`);
  lines.push(`Finished: ${input.runFinishedAt.toISOString()}`);
  lines.push("");
  lines.push("Per-system results:");
  for (const r of input.results) {
    const label = r.loadedReleaseLabel ? ` (release ${r.loadedReleaseLabel})` : "";
    if (r.error) {
      lines.push(`  - ${r.codeSystem}${label}: FAILED — ${r.error}`);
    } else {
      lines.push(`  - ${r.codeSystem}${label}: ${r.parsedRows} rows`);
    }
  }
  lines.push("");
  lines.push("Alert reasons:");
  for (const reason of input.reasons) {
    if (reason.kind === "error") {
      lines.push(`  - ${reason.codeSystem} errored: ${reason.message}`);
    } else {
      lines.push(
        `  - ${reason.codeSystem} returned 0 rows but a new release was due by ${reason.overdueSince}`,
      );
    }
  }
  lines.push("");
  lines.push(
    "Runbook: artifacts/therassistant-ehr/BILLING_CODES_REFRESH_RUNBOOK.md",
  );

  return {
    subject: `[therassistant] Billing-code refresh alert — ${headline}`.slice(0, 180),
    text: lines.join("\n"),
  };
}

async function emailOps(input: DispatchAlertInput): Promise<DispatchAlertOutcome["emailed"]> {
  const recipients = parseRecipients();
  if (recipients.length === 0) {
    return { ok: false, recipients, error: "BILLING_CODES_REFRESH_ALERT_EMAIL is not set" };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, recipients, error: "RESEND_API_KEY is not set" };
  }
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "alerts@therassistant.app";

  const { subject, text } = renderEmail(input);
  try {
    const client = new Resend(apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      text,
    });
    if (result.error) {
      return { ok: false, recipients, error: result.error.message || "Resend rejected" };
    }
    return { ok: true, recipients };
  } catch (err) {
    return {
      ok: false,
      recipients,
      error: err instanceof Error ? err.message : "Resend threw",
    };
  }
}

/**
 * Stable per-run synthetic uuid so the open-item dedupe index naturally folds
 * repeated alerts for the same problem into a single open ticket per org per
 * day (cron typically retries the same day). source_object_type='system_job'
 * was added in 20260601000000_source_object_type_system_job.sql.
 */
function syntheticSourceIdForRun(runStartedAt: Date): string {
  // Day-stable: same day → same uuid pattern (keeps RFC 4122 v4 shape).
  // YYYY-MM-DD → bytes → spread into a uuid template. We don't need crypto-
  // strength here; we just need stability within a day.
  const day = runStartedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const fill = (day + "00000000000000000000000000000000").slice(0, 32);
  const hex = fill.replace(/[^0-9a-f]/g, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function createWorkqueueItems(
  input: DispatchAlertInput,
): Promise<DispatchAlertOutcome["workqueue"]> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, created: 0, error: "Supabase env not configured" };
  }

  const { data: orgs, error: orgsErr } = await supabase
    .from("organizations")
    .select("id")
    .limit(500);
  if (orgsErr) {
    return { ok: false, created: 0, error: `organizations query failed: ${orgsErr.message}` };
  }
  if (!orgs || orgs.length === 0) {
    return { ok: false, created: 0, error: "no organizations found" };
  }

  const title = `Billing-code refresh alert: ${summarizeAlertReasons(input.reasons)}`.slice(0, 240);
  const description =
    `The monthly billing-code refresh failed or returned no rows for a code system whose release is overdue. ` +
    `See the runbook (BILLING_CODES_REFRESH_RUNBOOK.md) to triage and re-run.`;
  const sourceObjectId = syntheticSourceIdForRun(input.runStartedAt);
  const now = new Date().toISOString();
  let created = 0;
  const errors: string[] = [];

  for (const org of orgs as Array<{ id: string }>) {
    try {
      // Best-effort dedupe: check first, then insert. The partial unique index
      // (organization_id, source_object_type, source_object_id, work_type)
      // WHERE status='open' AND archived_at IS NULL will also catch races.
      const { data: existing } = await supabase
        .from("workqueue_items")
        .select("id")
        .eq("organization_id", org.id)
        .eq("source_object_type", "system_job")
        .eq("source_object_id", sourceObjectId)
        .eq("work_type", "billing_code_refresh_failure")
        .eq("status", "open")
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (existing?.id) continue;

      const { error: insertErr } = await supabase.from("workqueue_items").insert({
        organization_id: org.id,
        source_object_type: "system_job",
        source_object_id: sourceObjectId,
        work_type: "billing_code_refresh_failure",
        title,
        description,
        status: "open",
        priority: "high",
        context_payload: {
          run_started_at: input.runStartedAt.toISOString(),
          run_finished_at: input.runFinishedAt.toISOString(),
          per_system_results: input.results,
          reasons: input.reasons,
          synthetic_source_id: sourceObjectId,
        },
        created_at: now,
        updated_at: now,
      });
      if (insertErr) {
        // 23505 = unique_violation (race against dedupe index) — not an error.
        if ((insertErr as { code?: string }).code === "23505") continue;
        errors.push(`${org.id}: ${insertErr.message}`);
        continue;
      }
      created += 1;
    } catch (err) {
      errors.push(`${org.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (created === 0 && errors.length > 0) {
    return { ok: false, created, error: errors.slice(0, 3).join("; ") };
  }
  return { ok: true, created, error: errors.length ? errors.slice(0, 3).join("; ") : undefined };
}

export async function dispatchRefreshAlert(
  input: DispatchAlertInput,
): Promise<DispatchAlertOutcome> {
  const [emailed, workqueue] = await Promise.all([
    emailOps(input),
    createWorkqueueItems(input),
  ]);
  return { emailed, workqueue };
}

// Exported for tests.
export const __testing = { syntheticSourceIdForRun, renderEmail, randomUUID };
