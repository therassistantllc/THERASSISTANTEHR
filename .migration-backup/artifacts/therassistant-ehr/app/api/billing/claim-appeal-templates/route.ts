/**
 * POST /api/billing/claim-appeal-templates
 *
 * Creates a per-organization appeal or correction template. The
 * `claim_appeal_templates` table backs both the existing Denials
 * workqueue template picker and the new "Denied Claims by RARC"
 * queue's "Create correction/appeal template" action.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

interface Body {
  organizationId?: string;
  name?: string;
  body?: string;
  kind?: "correction" | "appeal";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const name = text(body.name);
    const tplBody = text(body.body);
    const kind = body.kind === "correction" ? "correction" : "appeal";

    if (!name || !tplBody) {
      return NextResponse.json(
        { success: false, error: "name and body are required" },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const insertRow: Record<string, unknown> = {
      organization_id: organizationId,
      name: kind === "correction" ? `[Correction] ${name}` : name,
      body: tplBody,
      is_system: false,
    };

    const { data, error } = await (supabase as any)
      .from("claim_appeal_templates")
      .insert(insertRow)
      .select("id, name, body, is_system")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 },
      );
    }

    // Audit trail
    await (supabase as any).from("audit_logs").insert({
      organization_id: organizationId,
      user_id: guard.userId,
      event_type: `denials_by_rarc.template.created`,
      event_summary: `Created ${kind} template "${name}"`,
      event_metadata: { kind, name },
      action: "create",
      object_type: "claim_appeal_template",
      object_id: text((data as any)?.id),
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ success: true, template: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
