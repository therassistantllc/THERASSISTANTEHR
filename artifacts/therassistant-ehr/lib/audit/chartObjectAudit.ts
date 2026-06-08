import type { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import type { StaffAuthContext } from "@/lib/rbac/auth";

type AdminClient = NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;

export type ChartAuditObjectType = "client" | "insurance_policy" | "client_case";

export type ChartAuditAction =
  | "demographic_field_updated"
  | "insurance_policy_created"
  | "insurance_policy_updated"
  | "insurance_policy_archived"
  | "client_case_created"
  | "client_case_updated"
  | "client_case_archived";

export interface WriteChartAuditParams {
  supabase: AdminClient;
  organizationId: string;
  patientId: string;
  staff: StaffAuthContext | null;
  objectType: ChartAuditObjectType;
  objectId: string;
  action: ChartAuditAction;
  objectLabel: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  columnLabels: Record<string, string>;
  contextMetadata?: Record<string, unknown>;
}

function describeStaff(staff: StaffAuthContext | null) {
  const userId = staff?.userId ?? null;
  const userRole = staff?.roles?.[0] ?? null;
  const actorEmail = staff?.email ?? null;
  const actorName = staff
    ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") || null
    : null;
  return { userId, userRole, actorEmail, actorName };
}

/**
 * Write one audit_logs row per changed field for a chart-attached object
 * (insurance policy, case, etc.). Mirrors the demographics audit pattern:
 * one row per (field, change) so the chart's "Recent changes" view can render
 * before/after cleanly.
 *
 * Throws if the audit insert fails — callers should run this BEFORE mutating
 * the underlying row so a failure refuses the mutation, matching demographics.
 */
export async function writeChartObjectAuditLogs(
  params: WriteChartAuditParams,
): Promise<void> {
  const {
    supabase,
    organizationId,
    patientId,
    staff,
    objectType,
    objectId,
    action,
    objectLabel,
    before,
    after,
    columnLabels,
    contextMetadata,
  } = params;

  const { userId, userRole, actorEmail, actorName } = describeStaff(staff);

  const fieldKeys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const rows: Array<Record<string, unknown>> = [];

  for (const column of fieldKeys) {
    const priorValue = before[column] ?? null;
    const newValue = after[column] ?? null;
    if (priorValue === newValue) continue;

    const label = columnLabels[column] ?? column;
    rows.push({
      organization_id: organizationId,
      patient_id: patientId,
      user_id: userId,
      user_role: userRole,
      action,
      object_type: objectType,
      object_id: objectId,
      before_value: { [column]: priorValue },
      after_value: { [column]: newValue },
      event_type: action,
      event_summary: `${objectLabel}: ${label} ${priorValue === null ? "set" : newValue === null ? "cleared" : "changed"}`,
      event_metadata: {
        field: column,
        field_label: label,
        object_label: objectLabel,
        actor_email: actorEmail,
        actor_name: actorName,
        ...(contextMetadata ?? {}),
      },
    });
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from("audit_logs").insert(rows as never);
  if (error) {
    console.error(
      `[chartObjectAudit] audit_logs insert failed for ${objectType} ${objectId}`,
      error.message,
    );
    throw new Error(
      `${objectLabel} change could not be recorded in the audit log. The update was not saved.`,
    );
  }
}
