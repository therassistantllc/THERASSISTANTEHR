import { NextResponse } from "next/server";
import { createCase, listCasesForClient, type CaseType } from "@/lib/cases/clientCasesService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { writeChartObjectAuditLogs } from "@/lib/audit/chartObjectAudit";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

const CASE_COLUMN_LABELS: Record<string, string> = {
  name: "Case name",
  case_type: "Case type",
  notes: "Notes",
  active_flag: "Active",
  is_default: "Default case",
  archived_at: "Archived",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const includeArchived = searchParams.get("includeArchived") === "true";
    const cases = await listCasesForClient({ organizationId, clientId: id, includeArchived });
    return NextResponse.json({ success: true, cases });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load cases" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      organizationId?: string;
      name?: string;
      caseType?: CaseType;
      notes?: string | null;
      activeFlag?: boolean;
      isDefault?: boolean;
    };
    const guard = await requireOrgAccess({
      requestedOrganizationId: body.organizationId,
    });
    if (guard instanceof NextResponse) return guard;
    const result = await createCase({
      organizationId: guard.organizationId,
      clientId: id,
      name: body.name ?? "",
      caseType: body.caseType,
      notes: body.notes ?? null,
      activeFlag: body.activeFlag,
      isDefault: body.isDefault,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, errors: result.errors }, { status: 400 });
    }

    // Best-effort audit of the new case. We audit AFTER the create because the
    // service auto-assigns isDefault when this is the client's first case;
    // auditing pre-mutation would miss that. If the audit insert fails the
    // case still exists — log loudly so ops can backfill.
    try {
      const supabase = createServerSupabaseAdminClient();
      const staff = await requireAuthenticatedStaff();
      if (supabase) {
        const created = result.case;
        // Derive the audit patient_id from the row the service actually
        // wrote, not from the URL path. If those ever disagree we trust the
        // database so the audit row sticks with the real chart.
        const patientId = String(created.clientId ?? id);
        await writeChartObjectAuditLogs({
          supabase,
          organizationId: guard.organizationId,
          patientId,
          staff,
          objectType: "client_case",
          objectId: created.id,
          action: "client_case_created",
          objectLabel: `Case: ${created.name}`,
          before: {
            name: null,
            case_type: null,
            notes: null,
            active_flag: null,
            is_default: null,
          },
          after: {
            name: created.name,
            case_type: created.caseType,
            notes: created.notes,
            active_flag: created.activeFlag ? "true" : "false",
            is_default: created.isDefault ? "true" : "false",
          },
          columnLabels: CASE_COLUMN_LABELS,
          contextMetadata: { case_name: created.name },
        });
      }
    } catch (auditError) {
      console.error(
        "[cases.POST] audit log insert failed for newly created case",
        auditError instanceof Error ? auditError.message : auditError,
      );
    }

    return NextResponse.json({ success: true, case: result.case });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create case" },
      { status: 500 },
    );
  }
}
