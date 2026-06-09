import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

type Row = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();

export async function GET(
  request: Request,
  context: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database unavailable" }, { status: 500 });
    }
    const { appointmentId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: appt } = await supabase
      .from("appointments")
      .select("id, client_id, service_location, telehealth_url")
      .eq("organization_id", organizationId)
      .eq("id", appointmentId)
      .maybeSingle();

    const clientId = (appt as Row | null)?.client_id as string | null;

    let priorSession: {
      encounterId: string;
      date: string | null;
      plan: string | null;
      assessment: string | null;
    } | null = null;

    let goals: Array<{ id: string; description: string; status: string }> = [];

    if (clientId) {
      const [encResult, goalsResult] = await Promise.allSettled([
        supabase
          .from("encounters")
          .select("id, service_date, encounter_status")
          .eq("organization_id", organizationId)
          .eq("client_id", clientId)
          .eq("encounter_status", "signed")
          .is("archived_at", null)
          .order("service_date", { ascending: false })
          .limit(1),
        (supabase as any)
          .from("treatment_plan_goals")
          .select("id, goal_description, description, goal_status, status")
          .eq("organization_id", organizationId)
          .eq("client_id", clientId)
          .is("archived_at", null)
          .order("created_at", { ascending: true })
          .limit(12),
      ]);

      if (encResult.status === "fulfilled" && !encResult.value.error) {
        const lastEnc = ((encResult.value.data ?? []) as Row[])[0];
        if (lastEnc) {
          const { data: note } = await supabase
            .from("encounter_clinical_notes")
            .select("plan, assessment")
            .eq("organization_id", organizationId)
            .eq("encounter_id", lastEnc.id)
            .is("archived_at", null)
            .maybeSingle();
          const noteRow = note as Row | null;
          const planRaw = text(noteRow?.plan);
          const assessRaw = text(noteRow?.assessment);
          priorSession = {
            encounterId: text(lastEnc.id),
            date: (lastEnc.service_date as string | null) ?? null,
            plan: planRaw || null,
            assessment: assessRaw || null,
          };
        }
      }

      if (goalsResult.status === "fulfilled") {
        const rows = ((goalsResult.value as any).data ?? []) as Row[];
        goals = rows
          .filter((g) => {
            const s = text(g.goal_status || g.status || "active");
            return s === "active" || s === "in_progress" || s === "";
          })
          .map((g) => ({
            id: text(g.id),
            description: text(g.goal_description || g.description || ""),
            status: text(g.goal_status || g.status || "active"),
          }));
      }
    }

    const serviceLocation = text((appt as Row | null)?.service_location ?? "");
    const telehealthUrl = text((appt as Row | null)?.telehealth_url ?? "") || null;
    const isVirtual =
      telehealthUrl !== null || /telehealth|video|virtual|remote/i.test(serviceLocation);

    return NextResponse.json({
      success: true,
      priorSession,
      goals,
      telehealth: { isVirtual, existingUrl: telehealthUrl },
    });
  } catch (error) {
    console.error("[workspace-context]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "workspace-context failed",
      },
      { status: 500 },
    );
  }
}
