/**
 * Outbound fax-queue dispatcher.
 *
 * Drains pending `fax_queue` rows by:
 *   1. Looking up the matching `claim_documentation_transmissions` row
 *      (linked via `channel='fax'` AND `provider_message_id = fax_queue.id`,
 *      which the medical-review "Send documentation" action writes when it
 *      enqueues the fax).
 *   2. Downloading each referenced document from Supabase storage.
 *   3. Merging PDFs + raster images into a single PDF via
 *      `mergeDocumentsToPdf`.
 *   4. Uploading that merged PDF to the `fax-outbound` bucket and minting
 *      a short-lived signed URL.
 *   5. Calling `resolveFaxProvider().send({ to, mediaUrl })`.
 *   6. Updating both `fax_queue` (status, sent_at, error) and the matching
 *      transmission row (status, sent_at, error, provider_message_id) so the
 *      Submission history tab shows the real delivery state instead of
 *      sitting on "queued" forever.
 *
 * Designed to be safe to re-run: each iteration first flips a `pending` row
 * to `processing` so a second concurrent worker won't pick it up again.
 */
import type { FaxProvider } from "@/lib/fax/provider";
import { resolveFaxProvider, type SendOutboundFaxResult } from "@/lib/fax/provider";
import {
  mergeDocumentsToPdf,
  type MergeAttachmentInput,
} from "@/lib/pdf/mergeDocumentsToPdf";

const FAX_OUTBOUND_BUCKET = "fax-outbound";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Maximum number of times the dispatcher will automatically attempt a
 * single fax_queue row before declaring it terminally failed. A biller
 * can still bypass this by hitting Retry in the UI (which resets the
 * counter). Task #790.
 */
export const MAX_FAX_ATTEMPTS = 5;

/**
 * Exponential backoff between automatic retries.
 *
 *   attempt 1 fail → wait  5m before next try
 *   attempt 2 fail → wait 15m
 *   attempt 3 fail → wait 45m
 *   attempt 4 fail → wait  2h15m
 *
 * Capped at 6 hours so a long-running outage doesn't push the next try
 * out by days. We never use the value past `MAX_FAX_ATTEMPTS - 1` because
 * the last failure is terminal.
 */
export function faxRetryBackoffMs(attemptCount: number): number {
  const base = 5 * 60 * 1000;
  const grow = base * Math.pow(3, Math.max(0, attemptCount - 1));
  return Math.min(grow, 6 * 60 * 60 * 1000);
}

// Minimal structural type so this file does not have to import the entire
// generated Supabase types (and so the test suite can pass a hand-rolled
// fake client). We only touch a handful of operations.
type StorageBlob = { arrayBuffer(): Promise<ArrayBuffer> };
type StorageBucketClient = {
  download(path: string): Promise<{ data: StorageBlob | null; error: { message?: string } | null }>;
  upload(
    path: string,
    body: Uint8Array | Buffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: { message?: string } | null }>;
};
type StorageClient = {
  from(bucket: string): StorageBucketClient;
  listBuckets(): Promise<{ data: Array<{ name: string }> | null; error: { message?: string } | null }>;
  createBucket(
    name: string,
    opts: { public?: boolean; fileSizeLimit?: number },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};
type TableBuilder = {
  select: (cols: string, opts?: Record<string, unknown>) => TableBuilder;
  insert: (v: unknown) => TableBuilder;
  update: (v: unknown) => TableBuilder;
  eq: (col: string, val: unknown) => TableBuilder;
  in: (col: string, vals: unknown[]) => TableBuilder;
  is: (col: string, val: unknown) => TableBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => TableBuilder;
  limit: (n: number) => TableBuilder;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
  single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
  then?: (...args: unknown[]) => unknown;
};
type SupabaseLike = {
  from(table: string): TableBuilder;
  storage: StorageClient;
};

export interface FaxDispatchResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  providerName: string;
  perFax: Array<{
    faxId: string;
    status: "sent" | "failed" | "skipped";
    error?: string | null;
    providerMessageId?: string | null;
  }>;
}

export interface RunFaxQueueDispatchOptions {
  organizationId: string;
  /** Hard cap on how many rows one invocation will attempt (default 25). */
  maxFaxes?: number;
  /** Inject a provider in tests; production resolves Telnyx automatically. */
  provider?: FaxProvider;
}

async function ensureOutboundBucket(storage: StorageClient): Promise<void> {
  try {
    const { data: buckets } = await storage.listBuckets();
    if (buckets && buckets.some((b) => b.name === FAX_OUTBOUND_BUCKET)) return;
    const { error } = await storage.createBucket(FAX_OUTBOUND_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (error && !/already exists/i.test(error.message ?? "")) {
      console.warn(`[fax-worker] ensure bucket failed: ${error.message}`);
    }
  } catch (e) {
    console.warn(
      `[fax-worker] ensure bucket exception: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

type DocRow = {
  id: string;
  title: string | null;
  file_name: string | null;
  mime_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

async function downloadAttachments(
  supabase: SupabaseLike,
  organizationId: string,
  documentIds: string[],
): Promise<{ ok: true; attachments: MergeAttachmentInput[] } | { ok: false; error: string }> {
  if (documentIds.length === 0) {
    return { ok: false, error: "Transmission has no document_ids — nothing to fax." };
  }
  const docsQuery = supabase
    .from("documents")
    .select("id, title, file_name, mime_type, storage_bucket, storage_path")
    .eq("organization_id", organizationId)
    .in("id", documentIds);
  const { data: rows, error } = (await (docsQuery as unknown as Promise<{
    data: DocRow[] | null;
    error: { message?: string } | null;
  }>));
  if (error) return { ok: false, error: error.message ?? "Failed to load documents" };
  const docs = (rows ?? []).filter((d) => d.storage_bucket && d.storage_path);
  if (docs.length === 0) {
    return { ok: false, error: "Referenced documents are missing or have no storage location." };
  }
  // Preserve the order from document_ids so the cover letter (first) leads.
  const byId = new Map(docs.map((d) => [String(d.id), d]));
  const ordered = documentIds.map((id) => byId.get(id)).filter((d): d is DocRow => !!d);

  const attachments: MergeAttachmentInput[] = [];
  for (const d of ordered) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(String(d.storage_bucket))
      .download(String(d.storage_path));
    if (dlErr || !blob) {
      return {
        ok: false,
        error: `Failed to download ${d.file_name ?? d.id}: ${dlErr?.message ?? "unknown error"}`,
      };
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    attachments.push({
      title: d.title || d.file_name || "Document",
      fileName: d.file_name || `${d.id}.bin`,
      bytes: buf,
      mimeType: d.mime_type,
    });
  }
  return { ok: true, attachments };
}

async function uploadAndSign(
  supabase: SupabaseLike,
  organizationId: string,
  faxId: string,
  pdfBytes: Uint8Array,
): Promise<{ ok: true; signedUrl: string; storagePath: string } | { ok: false; error: string }> {
  const storagePath = `${organizationId}/${faxId}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(FAX_OUTBOUND_BUCKET)
    .upload(storagePath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) return { ok: false, error: `Storage upload failed: ${upErr.message ?? "unknown"}` };
  const { data: signed, error: signErr } = await supabase.storage
    .from(FAX_OUTBOUND_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return { ok: false, error: `Signed URL failed: ${signErr?.message ?? "no url"}` };
  }
  return { ok: true, signedUrl: signed.signedUrl, storagePath };
}

async function updateTransmission(
  supabase: SupabaseLike,
  transmissionId: string,
  organizationId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = (await (supabase
      .from("claim_documentation_transmissions")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", transmissionId) as unknown as Promise<{ error: { message?: string } | null }>));
    if (error) return { ok: false, error: error.message ?? "transmission update failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function updateFaxRow(
  supabase: SupabaseLike,
  faxId: string,
  organizationId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = (await (supabase
      .from("fax_queue")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", faxId) as unknown as Promise<{ error: { message?: string } | null }>));
    if (error) return { ok: false, error: error.message ?? "fax_queue update failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Atomically transition a fax row from 'pending' to 'processing' so no
 * concurrent dispatcher (e.g. cron + a manual run) can pick it up twice.
 * Returns true only when this caller is the one that owns the row.
 *
 * We rely on the row-level lock semantics of a Postgres conditional UPDATE
 * filtered by `status='pending'`: at most one concurrent UPDATE wins, the
 * other observes zero affected rows and skips the row.
 */
async function claimPendingFax(
  supabase: SupabaseLike,
  faxId: string,
  organizationId: string,
): Promise<{ ok: true; priorAttemptCount: number } | { ok: false }> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = (await (supabase
      .from("fax_queue")
      .update({ status: "processing", error: null, last_attempted_at: nowIso })
      .eq("organization_id", organizationId)
      .eq("id", faxId)
      .eq("status", "pending")
      .select("id, attempt_count") as unknown as Promise<{
        data: Array<{ id: string; attempt_count: number | null }> | null;
        error: { message?: string } | null;
      }>));
    if (error) return { ok: false };
    if (!Array.isArray(data) || data.length !== 1) return { ok: false };
    const prior = Number(data[0].attempt_count ?? 0);
    return { ok: true, priorAttemptCount: Number.isFinite(prior) ? prior : 0 };
  } catch {
    return { ok: false };
  }
}

export async function runFaxQueueDispatch(
  supabase: SupabaseLike,
  opts: RunFaxQueueDispatchOptions,
): Promise<FaxDispatchResult> {
  const { organizationId } = opts;
  const maxFaxes = Math.max(1, Math.min(opts.maxFaxes ?? 25, 100));
  const provider = opts.provider ?? (await resolveFaxProvider());

  await ensureOutboundBucket(supabase.storage);

  const pendingQuery = supabase
    .from("fax_queue")
    .select("id, to_fax_number, claim_id, attempt_count, next_attempt_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(maxFaxes);
  const { data: rows, error } = (await (pendingQuery as unknown as Promise<{
    data: Array<{
      id: string;
      to_fax_number: string;
      claim_id: string | null;
      attempt_count: number | null;
      next_attempt_at: string | null;
    }> | null;
    error: { message?: string } | null;
  }>));
  if (error) {
    return {
      scanned: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      providerName: provider.name,
      perFax: [],
    };
  }
  const candidates = rows ?? [];

  const result: FaxDispatchResult = {
    scanned: candidates.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    providerName: provider.name,
    perFax: [],
  };

  const nowMs = Date.now();

  for (const fax of candidates) {
    const faxId = String(fax.id);
    const recipient = String(fax.to_fax_number ?? "").trim();

    // Backoff gate: a previous automatic failure may have pushed
    // `next_attempt_at` into the future. Honor that window so we don't
    // pound a downed payer fax line every cron tick. Manual Retry from
    // the UI resets next_attempt_at to null, so a biller's explicit ask
    // is never delayed by this filter.
    if (fax.next_attempt_at && Date.parse(String(fax.next_attempt_at)) > nowMs) {
      result.skipped += 1;
      result.perFax.push({
        faxId,
        status: "skipped",
        error: `backoff: next attempt not due until ${String(fax.next_attempt_at)}`,
      });
      continue;
    }

    // Atomic claim: only one dispatcher wins the pending→processing flip.
    // Concurrent invocations of this worker see zero affected rows and skip.
    // The claim also returns the prior attempt_count so we can compute the
    // post-attempt counter on success/failure persistence below.
    const claim = await claimPendingFax(supabase, faxId, organizationId);
    if (!claim.ok) {
      result.skipped += 1;
      result.perFax.push({ faxId, status: "skipped", error: "another dispatcher already claimed this fax" });
      continue;
    }
    const priorAttemptCount = claim.priorAttemptCount;
    const newAttemptCount = priorAttemptCount + 1;

    // Find the matching transmission. Medical-review's enqueue stores the
    // fax_queue.id in transmission.provider_message_id; that becomes our
    // foreign key in lieu of a dedicated column.
    const { data: txRow } = (await supabase
      .from("claim_documentation_transmissions")
      .select("id, document_ids, status")
      .eq("organization_id", organizationId)
      .eq("channel", "fax")
      .eq("provider_message_id", faxId)
      .maybeSingle()) as unknown as {
      data: { id: string; document_ids: string[] | null; status: string } | null;
      error: { message?: string } | null;
    };
    const transmissionId = txRow?.id ? String(txRow.id) : null;
    const documentIds: string[] = Array.isArray(txRow?.document_ids)
      ? (txRow!.document_ids as string[]).map((s) => String(s)).filter(Boolean)
      : [];

    const sentAt = new Date();

    // Persist a failure on both rows. Two flavors:
    //
    //   - Transient (default): if we haven't hit MAX_FAX_ATTEMPTS yet,
    //     keep fax_queue.status='pending' and push next_attempt_at into
    //     the future using exponential backoff so the next cron tick
    //     waits a polite interval before trying again. The matching
    //     transmission row keeps its current 'queued' status (still in
    //     flight from the biller's perspective) but its error column is
    //     updated so Submission history surfaces the latest reason.
    //
    //   - Terminal: either an explicit terminal failure (structural data
    //     issue that won't be fixed by retrying — missing destination,
    //     missing transmission, no document_ids) OR the auto-retry cap
    //     was reached. Both rows flip to 'failed' with a clear "max
    //     retries exceeded" prefix so billers know it stopped on its own.
    //
    // attempt_count is incremented on every call regardless so the row's
    // history reflects every send attempt the dispatcher actually made.
    const failBoth = async (
      msg: string,
      opts?: { terminal?: boolean },
    ): Promise<void> => {
      const reachedCap = newAttemptCount >= MAX_FAX_ATTEMPTS;
      const isTerminal = opts?.terminal === true || reachedCap;
      const finalMsg =
        reachedCap && opts?.terminal !== true
          ? `Max retries exceeded after ${newAttemptCount} attempts: ${msg}`
          : msg;
      const nextAt = isTerminal
        ? null
        : new Date(Date.now() + faxRetryBackoffMs(newAttemptCount)).toISOString();

      const faxUpdate = await updateFaxRow(supabase, faxId, organizationId, {
        status: isTerminal ? "failed" : "pending",
        error: finalMsg,
        attempt_count: newAttemptCount,
        next_attempt_at: nextAt,
      });
      let txUpdate: { ok: true } | { ok: false; error: string } = { ok: true };
      if (transmissionId) {
        // On a transient failure, do NOT regress the transmission to
        // 'failed' — it's still pending another automatic attempt and the
        // Submission history shouldn't flip-flop. We do record the latest
        // error so reviewers can see what tripped the last try.
        const txPatch: Record<string, unknown> = isTerminal
          ? { status: "failed", error: finalMsg }
          : { error: finalMsg };
        txUpdate = await updateTransmission(
          supabase,
          transmissionId,
          organizationId,
          txPatch,
        );
      }
      result.failed += 1;
      const persistMsg =
        !faxUpdate.ok && !txUpdate.ok
          ? `${finalMsg} | persistence failed: ${faxUpdate.error}; ${(txUpdate as { error: string }).error}`
          : !faxUpdate.ok
            ? `${finalMsg} | fax_queue persistence failed: ${faxUpdate.error}`
            : !txUpdate.ok
              ? `${finalMsg} | transmission persistence failed: ${(txUpdate as { error: string }).error}`
              : finalMsg;
      if (!faxUpdate.ok || !txUpdate.ok) {
        console.warn(`[fax-worker] state drift on fax ${faxId}: ${persistMsg}`);
      }
      result.perFax.push({ faxId, status: "failed", error: persistMsg });
    };

    if (!recipient) {
      // Structural: no recipient = no possible retry. Terminal.
      await failBoth("fax_queue row has no destination number", { terminal: true });
      continue;
    }

    if (!transmissionId) {
      // No transmission to point at — most likely a row created by the
      // direct fax-queue POST endpoint rather than medical-review. Fail
      // it loudly so it doesn't sit pending forever. Retrying won't
      // change the linkage, so this is terminal.
      await failBoth(
        "No matching documentation transmission found for this fax — cannot resolve attached files.",
        { terminal: true },
      );
      continue;
    }
    if (documentIds.length === 0) {
      // Empty payload — retrying won't materialize attachments. Terminal.
      await failBoth("Documentation transmission has no document_ids to send.", {
        terminal: true,
      });
      continue;
    }

    const dl = await downloadAttachments(supabase, organizationId, documentIds);
    if (!dl.ok) {
      await failBoth(dl.error);
      continue;
    }

    let merged;
    try {
      merged = await mergeDocumentsToPdf(dl.attachments);
    } catch (e) {
      await failBoth(`Failed to merge documents into a single PDF: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const upload = await uploadAndSign(supabase, organizationId, faxId, merged.pdfBytes);
    if (!upload.ok) {
      await failBoth(upload.error);
      continue;
    }

    let send: SendOutboundFaxResult;
    try {
      send = await provider.send({ to: recipient, mediaUrl: upload.signedUrl });
    } catch (e) {
      send = {
        ok: false,
        error: `Fax provider threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (!send.ok) {
      await failBoth(send.error);
      continue;
    }

    // Provider accepted the job. Persist the terminal success state. If a
    // persistence step fails we count the fax as failed (from the worker's
    // perspective) and surface the drift so an operator can reconcile,
    // since the provider has already received the document.
    const faxUpdate = await updateFaxRow(supabase, faxId, organizationId, {
      status: "sent",
      error: null,
      sent_at: sentAt.toISOString(),
      attempt_count: newAttemptCount,
      next_attempt_at: null,
    });
    // Telnyx delivery is asynchronous — accepting the job means the
    // provider has the document, not that the recipient's machine has
    // answered. Mark the transmission as 'sending' so the Submission
    // history shows "in flight" until the status reconciler (or webhook)
    // flips it to 'delivered'/'failed' with Telnyx's terminal verdict.
    // We still record sent_at because it captures the hand-off moment.
    const txUpdate = await updateTransmission(supabase, transmissionId, organizationId, {
      status: "sending",
      error: null,
      sent_at: sentAt.toISOString(),
      provider_message_id: send.providerId,
    });
    if (!faxUpdate.ok || !txUpdate.ok) {
      const persistErr = [
        !faxUpdate.ok ? `fax_queue: ${faxUpdate.error}` : null,
        !txUpdate.ok ? `transmission: ${(txUpdate as { error: string }).error}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      const drift = `Provider accepted fax (${send.providerId}) but DB state drifted: ${persistErr}`;
      console.warn(`[fax-worker] state drift on fax ${faxId}: ${drift}`);
      result.failed += 1;
      result.perFax.push({
        faxId,
        status: "failed",
        error: drift,
        providerMessageId: send.providerId,
      });
      continue;
    }
    result.sent += 1;
    result.perFax.push({
      faxId,
      status: "sent",
      providerMessageId: send.providerId,
    });
  }

  return result;
}
