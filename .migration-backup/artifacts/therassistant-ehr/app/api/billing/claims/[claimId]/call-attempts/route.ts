/**
 * /api/billing/claims/[claimId]/call-attempts
 *
 * Task #634 — Structured payer-call outcomes.
 *
 * POST writes a row in `payer_call_attempts` *and* mirrors a
 * human-readable claim_notes entry so the Notes tab keeps reading
 * well. GET returns the structured attempts for a claim (used by the
 * detail panel + reports).
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { insertClaimNote } from "@/lib/billing/claimNotes";

const text = (v: unknown) => String(v ?? "").trim();

const CHANNELS = new Set([
  "claims_phone",
  "claims_fax",
  "provider_services",
  "other",
]);

const DISPOSITIONS = new Set([
  "dialed",
  "sent_fax",
  "spoke_with_rep",
  "left_voicemail",
  "no_answer",
]);

const CHANNEL_LABEL: Record<string, string> = {
  claims_phone: "Claims phone",
  claims_fax: "Claims fax",
  provider_services: "Provider services",
  other: "Payer contact",
};

const DISPOSITION_VERB: Record<string, string> = {
  dialed: "Called payer at",
  sent_fax: "Faxed payer at",
  spoke_with_rep: "Spoke with rep",
  left_voicemail: "Left voicemail",
  no_answer: "No answer",
};

async function loadClaim(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  claimId: string,
) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("professional_claims")
    .select("id, organization_id, payer_profile_id")
    .eq("id", claimId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data as {
    id: string;
    organization_id: string;
    payer_profile_id: string | null;
  } | null;
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
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }

    const { data, error } = await (supabase as any)
      .from("payer_call_attempts")
      .select(
        "id, contact_channel, number_dialed, disposition, acted_by_display_name, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, attempts: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}

interface AttemptBody {
  organizationId?: string;
  contact_channel?: string;
  number_dialed?: string | null;
  disposition?: string;
  payer_profile_id?: string | null;
  comment?: string | null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as AttemptBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const channel = text(body.contact_channel);
    if (!CHANNELS.has(channel)) {
      return NextResponse.json(
        { success: false, error: "contact_channel is required" },
        { status: 400 },
      );
    }

    const disposition = text(body.disposition);
    if (!DISPOSITIONS.has(disposition)) {
      return NextResponse.json(
        { success: false, error: "disposition is required" },
        { status: 400 },
      );
    }

    const numberDialed = body.number_dialed ? text(body.number_dialed) : null;
    const comment = body.comment ? text(body.comment).slice(0, 240) : "";

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const claim = await loadClaim(supabase, organizationId, claimId);
    if (!claim) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
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

    // Build the human-readable note body so the Notes tab keeps reading
    // the way it did before the structured table existed.
    const channelLabel = CHANNEL_LABEL[channel] ?? "Payer contact";
    const verb = DISPOSITION_VERB[disposition] ?? "Logged call";
    const numberPart = numberDialed
      ? ` ${numberDialed} (${channelLabel})`
      : ` (${channelLabel})`;
    const dialedishVerbs = new Set(["dialed", "sent_fax"]);
    const baseNoteBody = dialedishVerbs.has(disposition)
      ? `${verb}${numberPart}`
      : `${verb} — ${channelLabel}${numberDialed ? ` ${numberDialed}` : ""}`;
    const noteBody = comment ? `${baseNoteBody} — ${comment}` : baseNoteBody;

    const { data: insertedNote, error: noteError } = await insertClaimNote(
      supabase,
      {
        organizationId,
        claimId,
        body: noteBody,
        authorUserId: guard.userId,
        authorDisplayName,
        returning: "id, body, author_display_name, created_at",
      },
    );

    if (noteError) {
      return NextResponse.json(
        { success: false, error: noteError.message },
        { status: 422 },
      );
    }

    const payerProfileId =
      (body.payer_profile_id ? text(body.payer_profile_id) : null) ||
      claim.payer_profile_id ||
      null;

    const { data: attempt, error: attemptError } = await (supabase as any)
      .from("payer_call_attempts")
      .insert({
        organization_id: organizationId,
        claim_id: claimId,
        payer_profile_id: payerProfileId,
        contact_channel: channel,
        number_dialed: numberDialed,
        disposition,
        note_id: insertedNote?.id ?? null,
        acted_by_user_id: guard.userId ?? null,
        acted_by_display_name: authorDisplayName,
      })
      .select(
        "id, contact_channel, number_dialed, disposition, acted_by_display_name, created_at",
      )
      .single();

    if (attemptError) {
      // The note already wrote successfully — don't lose the human history
      // just because the structured row failed.
      return NextResponse.json(
        {
          success: false,
          error: attemptError.message,
          note: insertedNote ?? null,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      attempt,
      note: insertedNote ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
