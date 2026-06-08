import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { DEFAULT_ORG_ID } from "@/lib/config";

const SELECT =
  "id, organization_id, provider_id, name, service_type, cpt_code, default_subjective, default_objective, default_assessment, default_plan, is_default, created_at, updated_at";

type Ctx = {
  organizationId: string;
  // staffId of the authenticated clinician, or null in unauthenticated dev mode.
  staffId: string | null;
};

// Resolve the org + caller staff id for this request:
//   - If a staff user is signed in, ALWAYS use their org and staff id. The
//     query-param org is ignored entirely so a caller can't read or mutate
//     another tenant's templates by passing a different organizationId, and
//     they can't pin a personal template onto another clinician.
//   - If no auth context is available (unauthenticated dev/preview), fall
//     back to the query-param/header for both org and providerId. This
//     matches the project's existing convention for unauthenticated dev usage.
async function resolveContext(req: Request, body?: Record<string, unknown>): Promise<Ctx | null> {
  const ctx = await requireAuthenticatedStaff();
  if (ctx?.organizationId) {
    return { organizationId: ctx.organizationId, staffId: ctx.staffId };
  }
  const url = new URL(req.url);
  const organizationId =
    url.searchParams.get("organizationId") ||
    (body && typeof body.organizationId === "string" ? body.organizationId : "") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID ||
    "";
  if (!organizationId) return null;
  const providerIdParam =
    url.searchParams.get("providerId") ||
    (body && typeof body.providerId === "string" ? body.providerId : "") ||
    "";
  return { organizationId, staffId: providerIdParam || null };
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

// True iff the caller explicitly asked for a personal template. Accept both
// the explicit `scope` enum and the boolean `is_personal` shorthand.
function isPersonalScope(body: Record<string, unknown>): boolean {
  if (typeof body.scope === "string" && body.scope.toLowerCase() === "personal") return true;
  if (body.is_personal === true) return true;
  return false;
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const ctx = await resolveContext(request);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    // Org-wide rows (provider_id IS NULL) are visible to everyone in the org;
    // personal rows are visible ONLY to the clinician they belong to. In
    // unauthenticated dev mode (no staffId resolved) we still hide everyone's
    // personal templates — otherwise dev sessions would leak personal drafts
    // across clinicians.
    let query = supabase
      .from("note_templates")
      .select(SELECT)
      .eq("organization_id", ctx.organizationId)
      .is("archived_at", null);
    query = ctx.staffId
      ? query.or(`provider_id.is.null,provider_id.eq.${ctx.staffId}`)
      : query.is("provider_id", null);

    const { data, error } = await query
      .order("is_default", { ascending: false })
      .order("provider_id", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      organizationId: ctx.organizationId,
      providerId: ctx.staffId,
      templates: data ?? [],
    });
  } catch (error) {
    console.error("Note templates GET error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list note templates" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const ctx = await resolveContext(request, body);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const name = cleanString(body.name).trim();
    if (!name) {
      return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }

    const personal = isPersonalScope(body);
    if (personal && !ctx.staffId) {
      return NextResponse.json(
        { success: false, error: "providerId is required for personal templates" },
        { status: 400 },
      );
    }

    // Personal templates can't be the org default — `is_default` controls the
    // org-wide auto-pick at check-in and shouldn't be steerable by a personal
    // template (the unique index also enforces this at the DB level).
    const isDefault = personal ? false : Boolean(body.is_default);
    const providerId = personal ? ctx.staffId : null;
    const now = new Date().toISOString();

    if (isDefault) {
      // Only one org default per org; clear any existing default before inserting.
      await supabase
        .from("note_templates")
        .update({ is_default: false, updated_at: now })
        .eq("organization_id", ctx.organizationId)
        .is("provider_id", null)
        .eq("is_default", true)
        .is("archived_at", null);
    }

    const { data, error } = await supabase
      .from("note_templates")
      .insert({
        organization_id: ctx.organizationId,
        provider_id: providerId,
        name,
        service_type: optionalString(body.service_type),
        cpt_code: optionalString(body.cpt_code),
        default_subjective: cleanString(body.default_subjective),
        default_objective: cleanString(body.default_objective),
        default_assessment: cleanString(body.default_assessment),
        default_plan: cleanString(body.default_plan),
        is_default: isDefault,
        created_at: now,
        updated_at: now,
      })
      .select(SELECT)
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, template: data }, { status: 201 });
  } catch (error) {
    console.error("Note templates POST error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create note template" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const ctx = await resolveContext(request, body);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    // Make sure the caller owns the template they're editing: org-wide rows
    // are editable by any authenticated staff in the org (existing behavior);
    // personal rows are editable only by their owner.
    const { data: existing, error: existingError } = await supabase
      .from("note_templates")
      .select("id, provider_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Template not found" }, { status: 404 });
    }
    const ownerId = (existing as { provider_id: string | null }).provider_id;
    if (ownerId && ownerId !== ctx.staffId) {
      return NextResponse.json({ success: false, error: "Not allowed" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if ("name" in body) updates.name = cleanString(body.name).trim();
    if ("service_type" in body) updates.service_type = optionalString(body.service_type);
    if ("cpt_code" in body) updates.cpt_code = optionalString(body.cpt_code);
    if ("default_subjective" in body) updates.default_subjective = cleanString(body.default_subjective);
    if ("default_objective" in body) updates.default_objective = cleanString(body.default_objective);
    if ("default_assessment" in body) updates.default_assessment = cleanString(body.default_assessment);
    if ("default_plan" in body) updates.default_plan = cleanString(body.default_plan);

    const now = new Date().toISOString();
    updates.updated_at = now;

    if ("is_default" in body) {
      // Personal templates can never be the org default; silently ignore the
      // flag for personal rows so a stale UI toggle can't bypass the rule.
      if (ownerId) {
        updates.is_default = false;
      } else {
        const isDefault = Boolean(body.is_default);
        updates.is_default = isDefault;
        if (isDefault) {
          await supabase
            .from("note_templates")
            .update({ is_default: false, updated_at: now })
            .eq("organization_id", ctx.organizationId)
            .is("provider_id", null)
            .eq("is_default", true)
            .neq("id", id)
            .is("archived_at", null);
        }
      }
    }

    const { data, error } = await supabase
      .from("note_templates")
      .update(updates)
      .eq("organization_id", ctx.organizationId)
      .eq("id", id)
      .is("archived_at", null)
      .select(SELECT)
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, template: data });
  } catch (error) {
    console.error("Note templates PATCH error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update note template" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const ctx = await resolveContext(request);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    // Same ownership rule as PATCH — personal templates can only be archived
    // by their owner.
    const { data: existing, error: existingError } = await supabase
      .from("note_templates")
      .select("id, provider_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Template not found" }, { status: 404 });
    }
    const ownerId = (existing as { provider_id: string | null }).provider_id;
    if (ownerId && ownerId !== ctx.staffId) {
      return NextResponse.json({ success: false, error: "Not allowed" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("note_templates")
      .update({ archived_at: now, is_default: false, updated_at: now })
      .eq("organization_id", ctx.organizationId)
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Note templates DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete note template" },
      { status: 500 },
    );
  }
}
