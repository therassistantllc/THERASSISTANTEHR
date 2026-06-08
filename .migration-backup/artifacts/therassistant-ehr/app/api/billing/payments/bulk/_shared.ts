/**
 * Shared helpers for bulk payment action routes.
 *
 * Parses composite ids (`era:|cp:|mi:<uuid>`), enforces the role guard +
 * tenant binding, and writes audit_logs for every mutation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { writePaymentAuditLog } from "@/lib/payments/postingEngine/audit";
import type {
  PaymentAuditAction,
  PaymentAuditObjectType,
} from "@/lib/payments/postingEngine/audit";
import type { PostingActor } from "@/lib/payments/postingEngine";
import { parseCompositePostedPaymentId } from "@/app/api/billing/payments/posted/[id]/_compositeId";

export interface ParsedTarget {
  kind: "era_835" | "client_payment" | "insurance_manual";
  table: "era_claim_payments" | "client_payments" | "insurance_manual_payments";
  id: string;
  /** audit object_type to record. */
  auditObjectType: PaymentAuditObjectType;
}

export function parseTargets(ids: unknown): {
  targets: ParsedTarget[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(ids)) {
    return { targets: [], errors: ["ids must be a non-empty array"] };
  }
  if (ids.length === 0 || ids.length > 200) {
    return { targets: [], errors: ["ids must contain 1–200 entries"] };
  }
  const targets: ParsedTarget[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") {
      errors.push(`Invalid id: ${String(raw)}`);
      continue;
    }
    const parsed = parseCompositePostedPaymentId(raw);
    if (!parsed) {
      errors.push(`Invalid composite id: ${raw}`);
      continue;
    }
    if (parsed.kind === "era_835") {
      targets.push({
        kind: "era_835",
        table: "era_claim_payments",
        id: parsed.id,
        auditObjectType: "era_claim_payment",
      });
    } else if (parsed.kind === "client_payment") {
      targets.push({
        kind: "client_payment",
        table: "client_payments",
        id: parsed.id,
        auditObjectType: "client_payment",
      });
    } else {
      targets.push({
        kind: "insurance_manual",
        table: "insurance_manual_payments",
        id: parsed.id,
        auditObjectType: "insurance_manual_payment",
      });
    }
  }
  return { targets, errors };
}

export interface BulkActionContext {
  supabase: SupabaseClient;
  organizationId: string;
  actor: PostingActor;
  action: PaymentAuditAction;
  /** Free-text summary fragment, e.g. "deferred" / "archived". */
  verb: string;
  /** Optional metadata captured in audit_logs.event_metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Apply a per-target update to its native table + write one audit row.
 * Returns counts so the route can report success/failure breakdown.
 */
export async function applyBulkUpdate(
  ctx: BulkActionContext,
  targets: ParsedTarget[],
  /** Patch applied to each target row (already keyed by table). */
  buildPatch: (t: ParsedTarget) => Record<string, unknown>,
): Promise<{
  applied: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
  auditLogIds: string[];
}> {
  let applied = 0;
  let failed = 0;
  const errors: Array<{ id: string; message: string }> = [];
  const auditLogIds: string[] = [];

  for (const t of targets) {
    try {
      const patch = buildPatch(t);
      // `.select("id")` forces postgrest to return the affected rows so we
      // can verify the update actually matched a row in this org (rather
      // than silently no-op for missing or cross-tenant ids). Without this
      // we'd inflate `applied` and write phantom audit rows.
      const { data: updatedRows, error } = await ctx.supabase
        .from(t.table)
        .update(patch)
        .eq("id", t.id)
        .eq("organization_id", ctx.organizationId)
        .select("id");
      if (error) {
        failed++;
        errors.push({ id: `${t.kind}:${t.id}`, message: error.message });
        continue;
      }
      const matched = Array.isArray(updatedRows) ? updatedRows.length : 0;
      if (matched === 0) {
        failed++;
        errors.push({
          id: `${t.kind}:${t.id}`,
          message: "No matching row (already archived or not in this organization).",
        });
        continue;
      }
      applied++;
      const audit = await writePaymentAuditLog(ctx.supabase, {
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        action: ctx.action,
        objectType: t.auditObjectType,
        objectId: t.id,
        afterValue: patch,
        summary: `Bulk ${ctx.verb} on ${t.kind} ${t.id}`,
        metadata: { source: "bulk_action", ...(ctx.metadata ?? {}) },
      });
      if (audit) auditLogIds.push(audit.id);
    } catch (err) {
      failed++;
      errors.push({
        id: `${t.kind}:${t.id}`,
        message: err instanceof Error ? err.message : "update failed",
      });
    }
  }

  return { applied, failed, errors, auditLogIds };
}
