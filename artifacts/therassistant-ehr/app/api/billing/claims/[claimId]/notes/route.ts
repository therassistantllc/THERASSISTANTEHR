/**
 * /api/billing/claims/[claimId]/notes
 *
 * GET  — list claim notes for a claim, newest first.
 * POST — append a note. When `defer_until` is provided, also stamps
 *        professional_claims.defer_until / deferred_reason so the
 *        claim drops off the "No Response" worklist until that date.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

async function loadClaim(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  claimId: string,
) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("professional_claims")
    .select("id, organization_id")
    .eq("id", claimId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const claim = await loadClaim(supabase, organizationId, claimId);
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }

    const { data, error } = await (supabase as any)
      .from("claim_notes")
      .select("id, body, defer_until, author_user_id, author_display_name, rarc_codes, resolved_denial, created_at")
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, notes: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}

interface NoteBody {
  organizationId?: string;
  body?: string;
  defer_until?: string | null;
  rarc_codes?: string[] | null;
  resolved_denial?: boolean | null;
}

/**
 * Best-effort lookup of the RARC codes that apply to a claim. We union
 * what the ERA layer recorded (era_claim_payments.rarc_codes) with what
 * the denials workqueue surfaced (claim_workqueue_items.rarc_code). Used
 * to auto-tag notes added on denied claims so the "Denials by RARC"
 * detail panel can pull them as historical resolution notes.
 */
async function inferRarcCodesForClaim(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  claimId: string,
): Promise<string[]> {
  const codes = new Set<string>();
  const [{ data: eraRows }, { data: wqRows }] = await Promise.all([
    (supabase as any)
      .from("era_claim_payments")
      .select("rarc_codes")
      .eq("professional_claim_id", claimId),
    (supabase as any)
      .from("claim_workqueue_items")
      .select("rarc_code")
      .eq("claim_id", claimId)
      .is("archived_at", null),
  ]);
  for (const row of (eraRows as any[]) ?? []) {
    const arr = Array.isArray(row?.rarc_codes) ? row.rarc_codes : [];
    for (const c of arr) {
      const s = text(c).toUpperCase();
      if (s) codes.add(s);
    }
  }
  for (const row of (wqRows as any[]) ?? []) {
    const s = text(row?.rarc_code).toUpperCase();
    if (s) codes.add(s);
  }
  return Array.from(codes);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as NoteBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const noteBody = text(body.body);
    if (!noteBody) {
      return NextResponse.json(
        { success: false, error: "Note body is required" },
        { status: 400 },
      );
    }

    const deferUntil = body.defer_until ? text(body.defer_until) : null;
    if (deferUntil && !/^\d{4}-\d{2}-\d{2}$/.test(deferUntil)) {
      return NextResponse.json(
        { success: false, error: "defer_until must be a YYYY-MM-DD date" },
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

    const claim = await loadClaim(supabase, organizationId, claimId);
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }

    let authorDisplayName = "Staff";
    if (guard.staffId) {
      const { data: staffRow } = await supabase
        .from("staff_profiles")
        .select("first_name, last_name, email")
        .eq("id", guard.staffId)
        .maybeSingle();
      if (staffRow) {
        const composed = [staffRow.first_name, staffRow.last_name]
          .map((v) => text(v))
          .filter(Boolean)
          .join(" ");
        authorDisplayName = composed || text(staffRow.email) || "Staff";
      }
    }

    const explicitCodes = Array.isArray(body.rarc_codes)
      ? body.rarc_codes
          .map((c) => text(c).toUpperCase())
          .filter(Boolean)
      : null;
    const rarcCodes =
      explicitCodes && explicitCodes.length > 0
        ? explicitCodes
        : await inferRarcCodesForClaim(supabase, claimId);

    const insertRow = {
      organization_id: organizationId,
      claim_id: claimId,
      author_user_id: guard.userId,
      author_display_name: authorDisplayName,
      body: noteBody,
      defer_until: deferUntil,
      rarc_codes: rarcCodes,
      resolved_denial: Boolean(body.resolved_denial),
    };

    const { data: inserted, error: insertError } = await (supabase as any)
      .from("claim_notes")
      .insert(insertRow)
      .select("id, body, defer_until, author_user_id, author_display_name, rarc_codes, resolved_denial, created_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: insertError.message },
        { status: 422 },
      );
    }

    if (deferUntil) {
      const { error: updateError } = await (supabase as any)
        .from("professional_claims")
        .update({
          defer_until: deferUntil,
          deferred_reason: noteBody.slice(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updateError) {
        return NextResponse.json(
          { success: false, error: updateError.message },
          { status: 422 },
        );
      }
    }

    return NextResponse.json({ success: true, note: inserted });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
