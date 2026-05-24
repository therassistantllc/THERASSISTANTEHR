/**
 * POST /api/billing/vcc/actions
 *
 * Body: { organizationId, vccId, action, ...payload }
 *
 * Actions:
 *   - mark_processed   { processedAt? }
 *                      sets status='processed', processed_at, processed_by_user_id.
 *   - record_fee       { feeAmount }
 *                      sets fee_amount.
 *   - match_era        { paymentPostingId }
 *                      links the VCC to an existing payment_postings row.
 *   - post_payment     no extra payload — surfaces the manual-insurance
 *                      posting workspace URL for the linked claim (kept
 *                      server-side so the audit log records the intent).
 *   - upload_document  { mailroomItemId }
 *                      links the VCC to a mailroom_item record (the
 *                      upload itself happens via /api/mailroom/items).
 *
 * Every action writes one row to audit_logs.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, any>;
const text = (v: unknown) => String(v ?? "").trim();

interface ActionBody {
  organizationId?: string;
  vccId?: string;
  action?: string;
  processedAt?: string;
  feeAmount?: number | string;
  paymentPostingId?: string;
  mailroomItemId?: string;
}

async function writeAudit(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  args: {
    organizationId: string;
    userId: string | null;
    action: string;
    objectId: string;
    summary: string;
    metadata: Record<string, unknown>;
    claimId?: string | null;
    patientId?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  if (!supabase) return;
  await (supabase as any).from("audit_logs").insert({
    organization_id: args.organizationId,
    user_id: args.userId,
    event_type: `vcc.${args.action}`,
    event_summary: args.summary,
    event_metadata: args.metadata,
    action: args.action,
    object_type: "vcc_payment",
    object_id: args.objectId,
    claim_id: args.claimId ?? null,
    patient_id: args.patientId ?? null,
    before_value: args.before == null ? null : args.before,
    after_value: args.after == null ? null : args.after,
  });
}

async function loadVcc(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  vccId: string,
): Promise<DbRow | null> {
  if (!supabase) return null;
  const { data } = await (supabase as any)
    .from("vcc_payments")
    .select(
      "id, organization_id, status, fee_amount, payment_posting_id, mailroom_item_id, processed_at, processed_by_user_id, claim_id, client_id, payer_name, payment_amount",
    )
    .eq("organization_id", organizationId)
    .eq("id", vccId)
    .maybeSingle();
  return (data as DbRow) ?? null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ActionBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const action = text(body.action);
    const vccId = text(body.vccId);
    if (!action || !vccId) {
      return NextResponse.json(
        { success: false, error: "action and vccId are required" },
        { status: 400 },
      );
    }

    const vcc = await loadVcc(supabase, organizationId, vccId);
    if (!vcc) {
      return NextResponse.json(
        { success: false, error: "VCC payment not found" },
        { status: 404 },
      );
    }

    // ── mark_processed ─────────────────────────────────────────────────────
    if (action === "mark_processed") {
      const processedAt = text(body.processedAt) || new Date().toISOString();
      const patch = {
        status: "processed",
        processed_at: processedAt,
        processed_by_user_id: userId,
      };
      const { error } = await (supabase as any)
        .from("vcc_payments")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", vccId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action,
        objectId: vccId,
        claimId: text(vcc.claim_id) || null,
        patientId: text(vcc.client_id) || null,
        summary: `Marked VCC ${vccId.slice(0, 8)} processed (${text(vcc.payer_name) || "?"})`,
        metadata: { processedAt },
        before: { status: vcc.status, processed_at: vcc.processed_at },
        after: patch,
      });
      return NextResponse.json({ success: true, patch });
    }

    // ── record_fee ─────────────────────────────────────────────────────────
    if (action === "record_fee") {
      const fee = Number(body.feeAmount);
      if (!Number.isFinite(fee) || fee < 0) {
        return NextResponse.json(
          { success: false, error: "feeAmount must be a non-negative number" },
          { status: 400 },
        );
      }
      const patch = { fee_amount: Math.round(fee * 100) / 100 };
      const { error } = await (supabase as any)
        .from("vcc_payments")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", vccId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action,
        objectId: vccId,
        claimId: text(vcc.claim_id) || null,
        patientId: text(vcc.client_id) || null,
        summary: `Recorded VCC fee $${patch.fee_amount.toFixed(2)} on ${vccId.slice(0, 8)}`,
        metadata: { feeAmount: patch.fee_amount },
        before: { fee_amount: vcc.fee_amount },
        after: patch,
      });
      return NextResponse.json({ success: true, patch });
    }

    // ── match_era ──────────────────────────────────────────────────────────
    if (action === "match_era") {
      const postingId = text(body.paymentPostingId);
      if (!postingId) {
        return NextResponse.json(
          { success: false, error: "paymentPostingId is required" },
          { status: 400 },
        );
      }
      const { data: posting } = await (supabase as any)
        .from("payment_postings")
        .select("id, posting_reference, total_posted_amount")
        .eq("organization_id", organizationId)
        .eq("id", postingId)
        .maybeSingle();
      if (!posting) {
        return NextResponse.json(
          { success: false, error: "Payment posting not found" },
          { status: 404 },
        );
      }
      const patch = { payment_posting_id: postingId };
      const { error } = await (supabase as any)
        .from("vcc_payments")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", vccId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action,
        objectId: vccId,
        claimId: text(vcc.claim_id) || null,
        patientId: text(vcc.client_id) || null,
        summary: `Matched VCC ${vccId.slice(0, 8)} to ERA posting ${text((posting as DbRow).posting_reference) || postingId.slice(0, 8)}`,
        metadata: { paymentPostingId: postingId },
        before: { payment_posting_id: vcc.payment_posting_id },
        after: patch,
      });
      return NextResponse.json({ success: true, patch });
    }

    // ── post_payment ───────────────────────────────────────────────────────
    // Marks the VCC as processed (real state mutation) and returns a
    // handoff URL to the manual-insurance posting workspace. Client
    // applies the returned patch optimistically and opens the handoff in
    // a new tab — no full-page reload.
    if (action === "post_payment") {
      const claimId = text(vcc.claim_id);
      const postingHandoffUrl = claimId
        ? `/billing/payments/manual-insurance?claimId=${encodeURIComponent(claimId)}&vccId=${encodeURIComponent(vccId)}`
        : `/billing/payments/manual-insurance?vccId=${encodeURIComponent(vccId)}`;
      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: "processed",
        processed_at: nowIso,
        processed_by_user_id: userId,
      };
      const { error } = await (supabase as any)
        .from("vcc_payments")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", vccId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action,
        objectId: vccId,
        claimId: claimId || null,
        patientId: text(vcc.client_id) || null,
        summary: `Posted payment for VCC ${vccId.slice(0, 8)} (handoff to manual posting)`,
        before: { status: vcc.status, processed_at: vcc.processed_at },
        after: patch,
        metadata: { handoff: postingHandoffUrl },
      });
      return NextResponse.json({
        success: true,
        handoffUrl: postingHandoffUrl,
        patch: {
          status: "processed",
          processedAt: nowIso,
        },
      });
    }

    // ── upload_document ────────────────────────────────────────────────────
    if (action === "upload_document") {
      const mailroomItemId = text(body.mailroomItemId);
      if (!mailroomItemId) {
        return NextResponse.json(
          { success: false, error: "mailroomItemId is required" },
          { status: 400 },
        );
      }
      const { data: item } = await (supabase as any)
        .from("mailroom_items")
        .select("id, file_name")
        .eq("organization_id", organizationId)
        .eq("id", mailroomItemId)
        .maybeSingle();
      if (!item) {
        return NextResponse.json(
          { success: false, error: "Mailroom item not found" },
          { status: 404 },
        );
      }
      const patch = { mailroom_item_id: mailroomItemId };
      const { error } = await (supabase as any)
        .from("vcc_payments")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("id", vccId);
      if (error) throw error;
      await writeAudit(supabase, {
        organizationId,
        userId,
        action,
        objectId: vccId,
        claimId: text(vcc.claim_id) || null,
        patientId: text(vcc.client_id) || null,
        summary: `Attached document ${text((item as DbRow).file_name) || mailroomItemId.slice(0, 8)} to VCC ${vccId.slice(0, 8)}`,
        metadata: { mailroomItemId },
        before: { mailroom_item_id: vcc.mailroom_item_id },
        after: patch,
      });
      return NextResponse.json({ success: true, patch });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    console.error("VCC actions error:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
