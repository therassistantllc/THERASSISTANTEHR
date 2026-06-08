/**
 * GET  /api/billing/cob-issues/:id/card-suggestion
 *   Returns the most-recent OCR-parsed insurance-card suggestion that
 *   came in via the COB client-update form for this claim, plus any
 *   accept/discard decision already recorded.
 *
 * POST /api/billing/cob-issues/:id/card-suggestion
 *   body: { action: "accept" | "discard", organizationId, fields?, link_id? }
 *
 *   `accept` — inserts a new insurance_policies row (priority chosen
 *     by the next-available slot — secondary if primary already exists,
 *     tertiary otherwise) populated from the biller-confirmed fields,
 *     then writes a `cob_card_suggestion_accepted` audit row so the
 *     review UI knows the suggestion has been actioned and the new
 *     policy_id can be cross-referenced.
 *   `discard` — just writes a `cob_card_suggestion_discarded` audit
 *     row; the suggestion stays on the original update row for audit
 *     purposes but the review UI hides it.
 *
 * Both actions are billing-gated via requireBillingAccess.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type Row = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();

const SUGGESTION_EVENT = "cob_client_update_received";
const ACCEPT_EVENT = "cob_card_suggestion_accepted";
const DISCARD_EVENT = "cob_card_suggestion_discarded";

type Suggestion = {
  payer_name: string | null;
  member_id: string | null;
  group_number: string | null;
  plan_name: string | null;
  subscriber_name: string | null;
  rx_bin: string | null;
  rx_pcn: string | null;
  payer_phone: string | null;
  notes: string | null;
  confidence: {
    payer_name: number;
    member_id: number;
    group_number: number;
    plan_name: number;
    overall: number;
  };
  raw_text: string | null;
};

async function loadLatestSuggestion(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  claimId: string,
) {
  // Look at every cob_client_update_received row for this claim (newest
  // first). We also fetch the decision audit rows so a "already
  // accepted" or "already discarded" suggestion can be hidden from the
  // review UI's Accept/Discard buttons.
  const [{ data: updates, error: updErr }, { data: decisions, error: decErr }] =
    await Promise.all([
      (supabase as any)
        .from("audit_logs")
        .select("id, created_at, event_metadata")
        .eq("organization_id", organizationId)
        .eq("claim_id", claimId)
        .eq("event_type", SUGGESTION_EVENT)
        .order("created_at", { ascending: false })
        .limit(5),
      (supabase as any)
        .from("audit_logs")
        .select("id, created_at, event_type, event_metadata, user_id")
        .eq("organization_id", organizationId)
        .eq("claim_id", claimId)
        .in("event_type", [ACCEPT_EVENT, DISCARD_EVENT])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
  if (updErr) throw updErr;
  if (decErr) throw decErr;
  const updateRows = (updates ?? []) as Row[];
  const decisionRows = (decisions ?? []) as Row[];

  for (const u of updateRows) {
    const md = (u.event_metadata as Row | null) ?? {};
    const sug = md.card_suggestion as Suggestion | null | undefined;
    const status = text(md.card_suggestion_status) || null;
    if (!sug && !status) continue;
    const linkId = text(md.link_id) || null;
    const decision = decisionRows.find((d) => {
      const dmd = (d.event_metadata as Row | null) ?? {};
      return linkId && text(dmd.link_id) === linkId;
    });
    return {
      audit_id: text(u.id),
      created_at: text(u.created_at) || null,
      link_id: linkId,
      status,
      suggestion: sug ?? null,
      card_photo: (md.card_photo as Row | null) ?? null,
      card_photo_front: (md.card_photo_front as Row | null) ?? null,
      card_photo_back: (md.card_photo_back as Row | null) ?? null,
      other_coverage_note: text(md.other_coverage_note) || null,
      decision: decision
        ? {
            type:
              text(decision.event_type) === ACCEPT_EVENT
                ? ("accepted" as const)
                : ("discarded" as const),
            at: text(decision.created_at) || null,
            user_id: text(decision.user_id) || null,
            new_policy_id:
              text(
                ((decision.event_metadata as Row | null) ?? {}).new_policy_id,
              ) || null,
          }
        : null,
    };
  }
  return null;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;

    const found = await loadLatestSuggestion(supabase, guard.organizationId, id);
    if (found) {
      const signSide = async (
        ref: Row | null,
      ): Promise<string | null> => {
        if (!ref) return null;
        const bucket = text(ref.bucket);
        const path = text(ref.path);
        if (!bucket || !path) return null;
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 300);
        if (error || !data?.signedUrl) return null;
        return data.signedUrl;
      };
      const [frontUrl, backUrl] = await Promise.all([
        signSide(found.card_photo_front ?? found.card_photo),
        signSide(found.card_photo_back),
      ]);
      (found as Row).card_photo_front_url = frontUrl;
      (found as Row).card_photo_back_url = backUrl;
    }
    return NextResponse.json({ success: true, found });
  } catch (error) {
    console.error("Card suggestion GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load suggestion",
      },
      { status: 500 },
    );
  }
}

type AcceptFields = {
  payer_id?: string | null;
  payer_name?: string | null;
  member_id?: string | null;
  group_number?: string | null;
  plan_name?: string | null;
  subscriber_name?: string | null;
  priority?: "primary" | "secondary" | "tertiary" | null;
};

async function resolvePayerId(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  explicitPayerId: string | null,
  payerName: string | null,
): Promise<string | null> {
  if (explicitPayerId) {
    const { data } = await (supabase as any)
      .from("payer_profiles")
      .select("id")
      .eq("id", explicitPayerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data) return text(data.id);
  }
  if (!payerName) return null;
  // Case-insensitive exact match first, then a fuzzy ilike fallback.
  const { data: exact } = await (supabase as any)
    .from("payer_profiles")
    .select("id, payer_name")
    .eq("organization_id", organizationId)
    .ilike("payer_name", payerName)
    .limit(1);
  if (((exact ?? []) as Row[]).length > 0) return text((exact as Row[])[0].id);
  const { data: fuzzy } = await (supabase as any)
    .from("payer_profiles")
    .select("id, payer_name")
    .eq("organization_id", organizationId)
    .ilike("payer_name", `%${payerName}%`)
    .limit(2);
  const rows = (fuzzy ?? []) as Row[];
  if (rows.length === 1) return text(rows[0].id);
  return null;
}

async function nextAvailablePriority(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  clientId: string,
): Promise<"primary" | "secondary" | "tertiary" | null> {
  const { data: rows } = await (supabase as any)
    .from("insurance_policies")
    .select("priority")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .is("archived_at", null);
  const taken = new Set(
    ((rows ?? []) as Row[])
      .filter((r) => r.active_flag !== false)
      .map((r) => text(r.priority)),
  );
  for (const p of ["primary", "secondary", "tertiary"] as const) {
    if (!taken.has(p)) return p;
  }
  return null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      organizationId?: string;
      link_id?: string;
      fields?: AcceptFields;
    };
    const action = String(body.action ?? "").toLowerCase();
    if (action !== "accept" && action !== "discard") {
      return NextResponse.json(
        { success: false, error: `Unknown action: ${body.action ?? ""}` },
        { status: 400 },
      );
    }
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: claim } = await (supabase as any)
      .from("professional_claims")
      .select("id, organization_id, patient_id, appointment_id")
      .eq("id", id)
      .maybeSingle();
    if (!claim || text(claim.organization_id) !== organizationId) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }
    const clientId = text(claim.patient_id);
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Claim is not linked to a client." },
        { status: 422 },
      );
    }

    const found = await loadLatestSuggestion(supabase, organizationId, id);
    if (!found) {
      return NextResponse.json(
        { success: false, error: "No card suggestion found on this claim." },
        { status: 404 },
      );
    }
    if (found.decision) {
      return NextResponse.json(
        {
          success: false,
          error: `This suggestion was already ${found.decision.type}.`,
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const metadata: Row = {
      link_id: found.link_id,
      audit_id: found.audit_id,
    };

    let newPolicyId: string | null = null;

    if (action === "accept") {
      const fields: AcceptFields = body.fields ?? {};
      const sug = found.suggestion;
      const payerName = text(fields.payer_name ?? sug?.payer_name ?? "") || null;
      const memberId = text(fields.member_id ?? sug?.member_id ?? "") || null;
      const groupNumber =
        text(fields.group_number ?? sug?.group_number ?? "") || null;
      const planName = text(fields.plan_name ?? sug?.plan_name ?? "") || null;

      if (!memberId) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Member ID is required. Edit the suggestion and fill it in before accepting.",
          },
          { status: 422 },
        );
      }

      const payerId = await resolvePayerId(
        supabase,
        organizationId,
        text(fields.payer_id ?? "") || null,
        payerName,
      );

      let priority: "primary" | "secondary" | "tertiary" | null =
        fields.priority &&
        ["primary", "secondary", "tertiary"].includes(fields.priority)
          ? fields.priority
          : null;
      if (!priority) {
        priority = await nextAvailablePriority(supabase, organizationId, clientId);
      }
      if (!priority) {
        return NextResponse.json(
          {
            success: false,
            error:
              "All priority slots (primary, secondary, tertiary) are already filled. Reorder or archive an existing policy first.",
          },
          { status: 409 },
        );
      }

      const insertRow: Row = {
        organization_id: organizationId,
        client_id: clientId,
        priority,
        active_flag: true,
        payer_id: payerId,
        policy_number: memberId,
        subscriber_id: memberId,
        group_number: groupNumber,
        plan_name: planName,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data: inserted, error: insErr } = await (supabase as any)
        .from("insurance_policies")
        .insert(insertRow)
        .select("id")
        .maybeSingle();
      if (insErr) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to create policy: ${insErr.message}`,
          },
          { status: 500 },
        );
      }
      newPolicyId = inserted ? text(inserted.id) : null;
      metadata.new_policy_id = newPolicyId;
      metadata.priority = priority;
      metadata.payer_id = payerId;
      metadata.payer_name = payerName;
      metadata.member_id = memberId;
      metadata.group_number = groupNumber;
      metadata.plan_name = planName;
      metadata.payer_matched = !!payerId;
    } else {
      const reason = text((body.fields as Row | undefined)?.notes ?? "");
      if (reason) metadata.reason = reason.slice(0, 500);
    }

    await (supabase as any).from("audit_logs").insert({
      organization_id: organizationId,
      claim_id: id,
      patient_id: claim.patient_id ?? null,
      appointment_id: claim.appointment_id ?? null,
      event_type: action === "accept" ? ACCEPT_EVENT : DISCARD_EVENT,
      event_summary:
        action === "accept"
          ? "Card-OCR suggestion accepted → new insurance policy created"
          : "Card-OCR suggestion discarded by biller",
      event_metadata: metadata,
      user_id: guard.userId,
      action: action === "accept" ? ACCEPT_EVENT : DISCARD_EVENT,
      object_type: action === "accept" ? "insurance_policy" : "claim",
      object_id: action === "accept" ? newPolicyId ?? id : id,
    });

    return NextResponse.json({
      success: true,
      action,
      newPolicyId,
    });
  } catch (error) {
    console.error("Card suggestion POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update suggestion",
      },
      { status: 500 },
    );
  }
}
