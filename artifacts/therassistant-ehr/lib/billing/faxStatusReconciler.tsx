/**
 * Outbound fax status reconciler.
 *
 * The dispatcher (`runFaxQueueDispatch`) flips a transmission to status
 * 'sending' the moment Telnyx accepts the fax — but Telnyx delivery is
 * asynchronous, so the fax can still go busy / no-answer / line-dropped
 * downstream. Without this reconciler the Submission history would sit
 * on "SENDING" forever.
 *
 * This module polls Telnyx for the terminal status of every
 * `claim_documentation_transmissions` row that:
 *   - has channel='fax'
 *   - has a non-empty provider_message_id (so we have something to look
 *     up; rows still on the fax_queue.id placeholder are pre-handoff and
 *     get reconciled by the dispatcher instead)
 *   - is in a non-terminal status ('queued' or 'sending')
 *
 * When Telnyx reports 'delivered' we set the transmission to 'delivered'
 * and flag the matching fax_queue row 'sent' (its terminal success
 * state). When Telnyx reports 'failed' we set both rows to 'failed' with
 * the provider's failure_reason. Anything still in-flight is left as-is
 * and we'll re-poll next tick.
 */

type DbRow = Record<string, unknown>;
type QueryBuilder = {
  select: (cols: string, opts?: Record<string, unknown>) => QueryBuilder;
  update: (v: unknown) => QueryBuilder;
  eq: (col: string, val: unknown) => QueryBuilder;
  in: (col: string, vals: unknown[]) => QueryBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  then?: (...args: unknown[]) => unknown;
};
type SupabaseLike = { from(table: string): QueryBuilder };

import type { FaxProvider } from "@/lib/fax/provider";
import { resolveFaxProvider } from "@/lib/fax/provider";

export interface FaxReconcileResult {
  scanned: number;
  delivered: number;
  failed: number;
  stillSending: number;
  errors: number;
  providerName: string;
  perTransmission: Array<{
    transmissionId: string;
    providerMessageId: string;
    outcome: "delivered" | "failed" | "sending" | "error";
    providerStatus?: string | null;
    error?: string | null;
  }>;
}

export interface RunFaxStatusReconcileOptions {
  organizationId: string;
  /** Cap on rows polled per invocation (default 50). */
  maxRows?: number;
  /** Inject a provider in tests; production resolves Telnyx automatically. */
  provider?: FaxProvider;
}

async function updateRow(
  supabase: SupabaseLike,
  table: string,
  organizationId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = (await (supabase
      .from(table)
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", id) as unknown as Promise<{ error: { message?: string } | null }>));
    if (error) return { ok: false, error: error.message ?? `${table} update failed` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runFaxStatusReconcile(
  supabase: SupabaseLike,
  opts: RunFaxStatusReconcileOptions,
): Promise<FaxReconcileResult> {
  const { organizationId } = opts;
  const maxRows = Math.max(1, Math.min(opts.maxRows ?? 50, 200));
  const provider = opts.provider ?? (await resolveFaxProvider());

  const result: FaxReconcileResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    stillSending: 0,
    errors: 0,
    providerName: provider.name,
    perTransmission: [],
  };

  if (!provider.configured) {
    // Nothing to poll against — leave rows alone. Surface in the result
    // so the cron summary makes the cause obvious.
    return result;
  }

  const { data: rows, error } = (await (supabase
    .from("claim_documentation_transmissions")
    .select("id, provider_message_id, status, sent_at")
    .eq("organization_id", organizationId)
    .eq("channel", "fax")
    .in("status", ["queued", "sending"])
    .order("sent_at", { ascending: true })
    .limit(maxRows) as unknown as Promise<{
    data: DbRow[] | null;
    error: { message?: string } | null;
  }>));
  if (error) {
    result.errors += 1;
    return result;
  }
  // Filter out rows whose provider_message_id is still the placeholder
  // (the fax_queue.id the medical-review enqueue wrote). Those are
  // pre-handoff; the dispatcher owns them.
  const candidates = (rows ?? []).filter((r) => {
    const pid = String(r.provider_message_id ?? "").trim();
    if (!pid) return false;
    // Heuristic: real Telnyx fax ids are UUIDs; the placeholder is also
    // a UUID (the fax_queue.id) — we can't distinguish them by shape.
    // Instead, gate on sent_at: the dispatcher only writes sent_at when
    // it has stored Telnyx's real id, so rows with no sent_at are
    // pre-handoff and skipped.
    return !!String(r.sent_at ?? "").trim();
  });
  result.scanned = candidates.length;

  for (const row of candidates) {
    const txId = String(row.id);
    const providerId = String(row.provider_message_id);
    const status = await provider.getStatus(providerId);
    if (!status.ok) {
      result.errors += 1;
      result.perTransmission.push({
        transmissionId: txId,
        providerMessageId: providerId,
        outcome: "error",
        error: status.error,
      });
      continue;
    }

    if (status.normalized === "sending" || status.normalized === "unknown") {
      result.stillSending += 1;
      result.perTransmission.push({
        transmissionId: txId,
        providerMessageId: providerId,
        outcome: "sending",
        providerStatus: status.providerStatus,
      });
      continue;
    }

    if (status.normalized === "delivered") {
      const txUpd = await updateRow(supabase, "claim_documentation_transmissions", organizationId, txId, {
        status: "delivered",
        error: null,
      });
      if (!txUpd.ok) {
        result.errors += 1;
        result.perTransmission.push({
          transmissionId: txId,
          providerMessageId: providerId,
          outcome: "error",
          providerStatus: status.providerStatus,
          error: `transmission persistence failed: ${txUpd.error}`,
        });
        continue;
      }
      // We deliberately do NOT touch fax_queue here. The dispatcher
      // overwrote transmission.provider_message_id with Telnyx's id, so
      // we no longer have a key back to the originating fax_queue row.
      // fax_queue.status='sent' already means "handed off to provider";
      // delivery state lives on the transmission, which is what the
      // Submission history UI renders.
      result.delivered += 1;
      result.perTransmission.push({
        transmissionId: txId,
        providerMessageId: providerId,
        outcome: "delivered",
        providerStatus: status.providerStatus,
      });
      continue;
    }

    // normalized === "failed"
    const msg =
      status.failureReason ||
      (status.providerStatus ? `Telnyx reported ${status.providerStatus}` : "Telnyx reported failed");
    const txUpd = await updateRow(supabase, "claim_documentation_transmissions", organizationId, txId, {
      status: "failed",
      error: msg,
    });
    if (!txUpd.ok) {
      result.errors += 1;
      result.perTransmission.push({
        transmissionId: txId,
        providerMessageId: providerId,
        outcome: "error",
        providerStatus: status.providerStatus,
        error: `transmission persistence failed: ${txUpd.error}`,
      });
      continue;
    }
    // Same reason as the delivered branch: no key from Telnyx id back
    // to the originating fax_queue row, and fax_queue is not what the
    // Submission history reads.
    result.failed += 1;
    result.perTransmission.push({
      transmissionId: txId,
      providerMessageId: providerId,
      outcome: "failed",
      providerStatus: status.providerStatus,
      error: msg,
    });
  }

  return result;
}
