import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { AvailityJsonApiAdapter } from "@/lib/clearinghouse/adapters/AvailityJsonApiAdapter";
import { resolveClearinghouseCredential } from "@/lib/clearinghouse/credentials";
import { assertPayerEnrollmentsForBatch } from "@/lib/clearinghouse/payerEnrollmentGate";
import { assertClaimSubmissionReady, gateResponse } from "@/lib/validation/claimSubmissionGate";

/**
 * Submits a generated 837P batch to Availity via the EDI Services JSON API.
 *
 * Flow:
 *   1. Look up the batch (org-scoped) and assert it has generated X12 content.
 *   2. Reject submissions that are already in a terminal "submitted/accepted" state
 *      unless action === "retry" (which is only valid for "rejected" batches).
 *   3. Mint or reuse an idempotency key so a network retry never sends the claim twice.
 *   4. POST the X12 to Availity; persist the external transaction id, HTTP status,
 *      endpoint, attempt count, and last-attempted timestamp regardless of outcome.
 *   5. Flip batch_status to "submitted" on success or "rejected" on failure and bubble
 *      the underlying error message back to the caller so the UI can surface it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const organizationId = String(body.organizationId ?? "").trim();
    const isRetry = body.action === "retry";
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const { data: existing, error: lookupErr } = await supabase
      .from("claim_837p_batches")
      .select(
        "id, batch_number, batch_status, generated_file_content, submission_idempotency_key, submission_attempt_count, availity_transaction_id, updated_at",
      )
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupErr) {
      return NextResponse.json({ success: false, error: lookupErr.message }, { status: 422 });
    }
    if (!existing) {
      return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });
    }

    const currentStatus = String((existing as Record<string, unknown>).batch_status ?? "");
    const x12 = String((existing as Record<string, unknown>).generated_file_content ?? "");

    if (!x12) {
      return NextResponse.json(
        { success: false, error: "Batch has no generated 837P content. Generate the EDI file before submitting." },
        { status: 422 },
      );
    }

    // Hard guard against double-submission. Retries are only valid for "rejected" batches.
    if (currentStatus === "submitted" || currentStatus === "accepted") {
      return NextResponse.json(
        { success: false, error: `Batch is already ${currentStatus} (transaction ${(existing as Record<string, unknown>).availity_transaction_id ?? "unknown"}). Submission blocked.` },
        { status: 409 },
      );
    }
    if (isRetry && currentStatus !== "rejected") {
      return NextResponse.json(
        { success: false, error: `Retry only valid for rejected batches; this batch is ${currentStatus}.` },
        { status: 409 },
      );
    }
    if (!isRetry && currentStatus !== "generated" && currentStatus !== "ready_to_generate" && currentStatus !== "draft") {
      return NextResponse.json(
        { success: false, error: `Batch cannot be submitted from status "${currentStatus}".` },
        { status: 409 },
      );
    }

    // Idempotency: reuse existing key (lets the OA side dedupe a retry) or mint a new one.
    const existingKey = (existing as Record<string, unknown>).submission_idempotency_key as string | null;
    const idempotencyKey =
      existingKey ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${id}-${Date.now()}`);

    const prevAttemptCount = Number((existing as Record<string, unknown>).submission_attempt_count ?? 0);
    const attemptCount = prevAttemptCount + 1;
    const attemptedAt = new Date().toISOString();
    const observedUpdatedAt = String((existing as Record<string, unknown>).updated_at ?? "");

    // Atomic claim via optimistic concurrency: only succeeds if no other request has
    // modified this row (same status + same prior attempt count + same updated_at)
    // since we read it. Two concurrent POSTs cannot both claim the submission slot.
    const { data: claimed, error: claimErr } = await supabase
      .from("claim_837p_batches")
      .update({
        submission_idempotency_key: idempotencyKey,
        submission_attempt_count: attemptCount,
        last_submission_attempted_at: attemptedAt,
        updated_at: attemptedAt,
      })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("batch_status", currentStatus)
      .eq("submission_attempt_count", prevAttemptCount)
      .eq("updated_at", observedUpdatedAt)
      .select("id");
    if (claimErr) {
      return NextResponse.json({ success: false, error: claimErr.message }, { status: 422 });
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { success: false, error: "Batch was modified by another request. Reload and try again." },
        { status: 409 },
      );
    }

    // Resolve the credential for this org — Vault first, then legacy JSONB, then env-var fallback.
    // If none of these returns a key the adapter call below will throw with a clear message.
    const credential = await resolveClearinghouseCredential({
      organizationId,
      vendor: "availity",
    });
    if (!credential) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Availity credential configured for this organization. Add an API key on /settings/clearinghouse before submitting claims.",
        },
        { status: 412 },
      );
    }

    // Trading-partner readiness gate (T002). Blocks transmission if billing NPI/EIN/address
    // or authorized-representative fields are missing on the org's billing profile.
    const readiness = await assertClaimSubmissionReady(organizationId);
    const readinessBlocked = gateResponse(readiness);
    if (readinessBlocked) return readinessBlocked;

    // Per-payer trading-partner enrollment gate (T003). Production-only.
    // Sandbox submissions are allowed to run without enrollments so operators
    // can validate the full round-trip before completing payer enrollment.
    const enrollmentGate = await assertPayerEnrollmentsForBatch({
      supabase,
      organizationId,
      batchId: id,
      transactionType: "837P",
      environment: credential.environment,
    });
    if (!enrollmentGate.ok) {
      return NextResponse.json(
        {
          success: false,
          error: enrollmentGate.message,
          gate: {
            blocked: true,
            reason: "payer_not_enrolled",
            transactionType: "837P",
            environment: credential.environment,
            missing: enrollmentGate.missing,
            fixRoute: "/settings/payer-enrollments",
          },
        },
        { status: 422 },
      );
    }

    const adapter = new AvailityJsonApiAdapter({
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
    });
    const endpointUrl = `${adapter.baseUrl}/v1/claims/professional/x12`;

    try {
      const result = await adapter.submitProfessionalX12({ organizationId, x12, idempotencyKey });
      const externalId = extractTransactionId(result.data);
      const submittedAt = new Date().toISOString();

      const { data: updated, error: updateErr } = await supabase
        .from("claim_837p_batches")
        .update({
          batch_status: "submitted",
          submitted_at: submittedAt,
          availity_transaction_id: externalId,
          submission_error: null,
          last_submission_endpoint: endpointUrl,
          last_submission_http_status: result.httpStatus ?? 200,
          updated_at: submittedAt,
        })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id, batch_status, submitted_at, availity_transaction_id, submission_attempt_count")
        .single();

      if (updateErr) {
        return NextResponse.json({ success: false, error: updateErr.message }, { status: 422 });
      }

      // Task #442: append the per-attempt history row. Best-effort — a write
      // failure here must not mask a successful transmission, so we swallow.
      await recordAttempt(supabase, {
        organizationId,
        batchId: id,
        attemptNumber: attemptCount,
        attemptedAt: submittedAt,
        endpoint: endpointUrl,
        httpStatus: result.httpStatus ?? 200,
        idempotencyKey,
        externalTransactionId: externalId,
        outcome: "success",
        errorMessage: null,
        responseExcerpt: excerpt(result.data),
      });

      return NextResponse.json({
        success: true,
        batch: updated,
        availityTransactionId: externalId,
        attempt: attemptCount,
      });
    } catch (transportError) {
      const message = transportError instanceof Error ? transportError.message : "Availity submission failed";
      const failedAt = new Date().toISOString();
      // The adapter throws "Availity API <op> failed <status>: <body>" — pull the status out if present.
      const httpStatusMatch = message.match(/failed\s+(\d{3})/);
      const failureHttpStatus = httpStatusMatch ? Number(httpStatusMatch[1]) : null;

      await supabase
        .from("claim_837p_batches")
        .update({
          batch_status: "rejected",
          submission_error: message.slice(0, 2000),
          last_submission_endpoint: endpointUrl,
          last_submission_http_status: failureHttpStatus,
          updated_at: failedAt,
        })
        .eq("id", id)
        .eq("organization_id", organizationId);

      // Task #442: capture the failed attempt so the Retry History timeline
      // shows every miss, not just the most recent one.
      await recordAttempt(supabase, {
        organizationId,
        batchId: id,
        attemptNumber: attemptCount,
        attemptedAt: failedAt,
        endpoint: endpointUrl,
        httpStatus: failureHttpStatus,
        idempotencyKey,
        externalTransactionId: null,
        outcome: "failure",
        errorMessage: message,
        responseExcerpt: message,
      });

      return NextResponse.json(
        { success: false, error: message, attempt: attemptCount, idempotencyKey, httpStatus: failureHttpStatus },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}

/**
 * Persist a single transmission attempt to the per-batch history table
 * (Task #442). Best-effort: errors are logged and swallowed so a history
 * write failure never masks the actual transmission outcome the caller
 * just observed.
 */
async function recordAttempt(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  attempt: {
    organizationId: string;
    batchId: string;
    attemptNumber: number;
    attemptedAt: string;
    endpoint: string | null;
    httpStatus: number | null;
    idempotencyKey: string | null;
    externalTransactionId: string | null;
    outcome: "success" | "failure";
    errorMessage: string | null;
    responseExcerpt: string | null;
  },
): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await (supabase as any)
      .from("claim_837p_batch_transmission_attempts")
      .insert({
        organization_id: attempt.organizationId,
        batch_id: attempt.batchId,
        attempt_number: attempt.attemptNumber,
        attempted_at: attempt.attemptedAt,
        endpoint: attempt.endpoint,
        http_status: attempt.httpStatus,
        idempotency_key: attempt.idempotencyKey,
        external_transaction_id: attempt.externalTransactionId,
        outcome: attempt.outcome,
        error_message: attempt.errorMessage ? attempt.errorMessage.slice(0, 2000) : null,
        response_excerpt: attempt.responseExcerpt ? attempt.responseExcerpt.slice(0, 4000) : null,
      });
    if (error) {
      console.warn("[837p submit] failed to persist transmission attempt", error.message);
    }
  } catch (e) {
    console.warn(
      "[837p submit] failed to persist transmission attempt",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** Stringify an arbitrary response payload to a short, readable excerpt. */
function excerpt(data: unknown): string | null {
  if (data == null) return null;
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return s.slice(0, 4000);
  } catch {
    return null;
  }
}

// Availity's submission response shape isn't perfectly fixed across endpoints,
// so we try a few common fields and fall back to null. The audit row in
// `clearinghouse_api_requests` always carries the full raw response either way.
function extractTransactionId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const candidates = [
    d.transactionId,
    d.submissionId,
    d.referenceId,
    (d.data as Record<string, unknown> | undefined)?.transactionId,
    (d.data as Record<string, unknown> | undefined)?.submissionId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}
