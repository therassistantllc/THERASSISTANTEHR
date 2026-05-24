/**
 * POST /api/billing/paper-checks/[id]/actions
 *
 * Run a lifecycle action against a paper check.
 *
 * Actions:
 *   - upload_eob          { paper_eob_url, scanned_check_url? }
 *   - mark_deposited      { deposit_date?, deposit_notes? }
 *   - post_payment        { note? }       → status='posted' (claims must be matched)
 *   - match_claims        { claim_ids: string[], applied_amounts?: number[] }
 *   - resolve_mismatch    { resolution: 'returned'|'void'|'unmatched', note? }
 *
 * Every action writes a paper_check_events audit row and returns the
 * updated check row + matches so the client can patch the table in place.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }
    const { id: checkId } = await ctx.params;
    if (!checkId) {
      return NextResponse.json({ success: false, error: "Missing check id" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guard = await requireBillingAccess({
      requestedOrganizationId:
        typeof body.organizationId === "string" ? body.organizationId : null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // Confirm the check belongs to this org.
    const { data: existing, error: getErr } = await (supabase as any)
      .from("paper_checks")
      .select(
        "id, organization_id, posting_status, amount, payer_profile_id, check_number, check_date, paper_eob_url",
      )
      .eq("id", checkId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Paper check not found" }, { status: 404 });
    }

    const action = text(body.action);
    if (!action) {
      return NextResponse.json({ success: false, error: "Missing action" }, { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    let patch: Record<string, unknown> = {};
    let eventMessage = "";
    const eventPayload: Record<string, unknown> = {};

    switch (action) {
      case "upload_eob": {
        const eobUrl = typeof body.paper_eob_url === "string" ? body.paper_eob_url.trim() : "";
        const scanUrl =
          typeof body.scanned_check_url === "string" ? body.scanned_check_url.trim() : "";
        if (!eobUrl && !scanUrl) {
          return NextResponse.json(
            { success: false, error: "Provide a paper EOB or scanned check URL" },
            { status: 400 },
          );
        }
        if (eobUrl) patch.paper_eob_url = eobUrl;
        if (scanUrl) patch.scanned_check_url = scanUrl;
        eventMessage = eobUrl ? "Paper EOB uploaded" : "Scanned check uploaded";
        eventPayload.paper_eob_url = eobUrl || undefined;
        eventPayload.scanned_check_url = scanUrl || undefined;
        break;
      }
      case "mark_deposited": {
        const depositDate =
          typeof body.deposit_date === "string" && body.deposit_date
            ? body.deposit_date
            : today;
        patch = {
          deposit_date: depositDate,
          posting_status: existing.posting_status === "posted" ? "posted" : "deposited",
        };
        if (typeof body.deposit_notes === "string" && body.deposit_notes.trim()) {
          patch.deposit_notes = body.deposit_notes.trim();
        }
        eventMessage = `Marked deposited on ${depositDate}`;
        eventPayload.deposit_date = depositDate;
        break;
      }
      case "post_payment": {
        // Load every matched claim along with its client_id so we can write
        // insurance_manual_payments + payment_applications rows for each one.
        const { data: matchRows, error: matchErr } = await (supabase as any)
          .from("paper_check_claim_matches")
          .select("claim_id, applied_amount")
          .eq("organization_id", organizationId)
          .eq("paper_check_id", checkId);
        if (matchErr) throw matchErr;
        const matchList = (matchRows ?? []) as DbRow[];
        if (matchList.length === 0) {
          return NextResponse.json(
            { success: false, error: "Match at least one claim before posting" },
            { status: 400 },
          );
        }
        const noteText =
          typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

        // Hydrate claim → client_id for the insurance_manual_payments insert.
        const claimIds = matchList.map((m) => text(m.claim_id));
        const { data: claimRows, error: claimErr } = await (supabase as any)
          .from("professional_claims")
          .select("id, patient_id")
          .eq("organization_id", organizationId)
          .in("id", claimIds);
        if (claimErr) throw claimErr;
        const clientByClaim = new Map<string, string | null>(
          ((claimRows ?? []) as DbRow[]).map((c) => [
            text(c.id),
            (c.patient_id as string | null) ?? null,
          ]),
        );

        // Up-front validation pass: every matched claim must have a patient
        // linkage (both insurance_manual_payments.client_id and
        // payment_applications.client_id are NOT NULL) and a positive
        // applied_amount (payment_applications CHECKs applied_amount > 0,
        // and a zero-amount match means no money moves on that claim — we
        // refuse to mark the whole check 'posted' in that state). Bail
        // before any insert so we never end up with a half-posted check or
        // a "posted" check with zero ledger impact.
        const missingClient = matchList
          .map((m) => text(m.claim_id))
          .filter((cid) => !clientByClaim.get(cid));
        if (missingClient.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Cannot post: claim(s) ${missingClient.join(", ")} have no patient linkage.`,
            },
            { status: 400 },
          );
        }
        const nonPositive = matchList
          .filter((m) => money(m.applied_amount) <= 0)
          .map((m) => text(m.claim_id));
        if (nonPositive.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Cannot post: claim(s) ${nonPositive.join(", ")} have a zero or negative applied amount. Set a positive applied amount on each match before posting.`,
            },
            { status: 400 },
          );
        }

        // Idempotency: every manual-payment row we write for this check is
        // tagged with this deterministic marker. We treat a (check, claim) as
        // "posted" only when *both* the insurance_manual_payments row and its
        // payment_applications row exist. If a previous attempt crashed after
        // writing the manual payment but before writing its application, we
        // detect the orphan via payment_source_id and finish it on retry
        // instead of silently skipping the claim (which would leave the claim
        // balance untouched even though the manual payment was recorded).
        const eobMarker = `paper_check:${checkId}`;
        const { data: alreadyPosted, error: dupErr } = await (supabase as any)
          .from("insurance_manual_payments")
          .select("id, claim_id, client_id, paid_amount")
          .eq("organization_id", organizationId)
          .eq("eob_reference", eobMarker)
          .is("archived_at", null);
        if (dupErr) throw dupErr;
        const existingByClaim = new Map<string, DbRow>();
        for (const r of (alreadyPosted ?? []) as DbRow[]) {
          existingByClaim.set(text(r.claim_id), r);
        }
        let existingApps: DbRow[] = [];
        if (existingByClaim.size > 0) {
          const sourceIds = Array.from(existingByClaim.values()).map((r) => text(r.id));
          const { data: appRows, error: appLookupErr } = await (supabase as any)
            .from("payment_applications")
            .select("payment_source_id")
            .eq("organization_id", organizationId)
            .eq("payment_kind", "insurance")
            .in("payment_source_id", sourceIds)
            .is("archived_at", null);
          if (appLookupErr) throw appLookupErr;
          existingApps = (appRows ?? []) as DbRow[];
        }
        const appliedSourceIds = new Set(
          existingApps.map((r) => text(r.payment_source_id)),
        );

        const postedClaimIds: string[] = [];
        const recoveredClaimIds: string[] = [];
        const skippedClaimIds: string[] = [];

        for (const m of matchList) {
          const claimId = text(m.claim_id);
          const appliedAmount = money(m.applied_amount);

          const prior = existingByClaim.get(claimId);
          if (prior) {
            // Already have a manual payment row for this (check, claim).
            // Just make sure its paired payment_applications row exists.
            const priorId = text(prior.id);
            if (appliedSourceIds.has(priorId)) {
              skippedClaimIds.push(claimId);
              continue;
            }
            const priorAmount = money(prior.paid_amount);
            if (priorAmount <= 0) {
              skippedClaimIds.push(claimId);
              continue;
            }
            const { error: recoverErr } = await (supabase as any)
              .from("payment_applications")
              .insert({
                organization_id: organizationId,
                payment_kind: "insurance",
                payment_source_id: priorId,
                client_id: (prior.client_id as string | null) ?? clientByClaim.get(claimId),
                claim_id: claimId,
                applied_amount: priorAmount,
              });
            if (recoverErr) throw recoverErr;
            recoveredClaimIds.push(claimId);
            continue;
          }

          // Skip zero/negative applied amounts — payment_applications has a
          // CHECK applied_amount > 0 and posting nothing matches reality.
          if (appliedAmount <= 0) {
            skippedClaimIds.push(claimId);
            continue;
          }
          const clientId = clientByClaim.get(claimId)!; // guaranteed by upfront validation

          const { data: impRow, error: impErr } = await (supabase as any)
            .from("insurance_manual_payments")
            .insert({
              organization_id: organizationId,
              claim_id: claimId,
              client_id: clientId,
              eob_reference: eobMarker,
              allowed_amount: appliedAmount,
              paid_amount: appliedAmount,
              adjustment_amount: 0,
              patient_responsibility_amount: 0,
              note: noteText,
              payer_profile_id:
                (existing.payer_profile_id as string | null) ?? null,
              check_number: (existing.check_number as string | null) ?? null,
              payment_date:
                (existing.check_date as string | null) ?? today,
              posted_actor_id: guard.userId ?? null,
              posting_status: "posted",
            })
            .select("id")
            .single();
          if (impErr) throw impErr;
          const manualPaymentId = text((impRow as DbRow).id);

          const { error: appErr } = await (supabase as any)
            .from("payment_applications")
            .insert({
              organization_id: organizationId,
              payment_kind: "insurance",
              payment_source_id: manualPaymentId,
              client_id: clientId,
              claim_id: claimId,
              applied_amount: appliedAmount,
            });
          if (appErr) {
            // We just wrote the manual-payment row but the application
            // failed. Re-throw so the request 500s — on the next retry the
            // recovery branch above will find the orphaned manual payment
            // by eob_reference and finish writing its application.
            throw appErr;
          }

          postedClaimIds.push(claimId);
        }

        patch = { posting_status: "posted" };
        const totalAffected = postedClaimIds.length + recoveredClaimIds.length;
        eventMessage =
          totalAffected > 0
            ? `Payment posted to ${totalAffected} claim(s)`
            : "Payment already posted (no new applications)";
        if (noteText) eventPayload.note = noteText;
        eventPayload.posted_claim_ids = postedClaimIds;
        if (recoveredClaimIds.length > 0) {
          eventPayload.recovered_claim_ids = recoveredClaimIds;
        }
        if (skippedClaimIds.length > 0) {
          eventPayload.skipped_claim_ids = skippedClaimIds;
        }
        break;
      }
      case "match_claims": {
        const claimIds = Array.isArray(body.claim_ids)
          ? (body.claim_ids as unknown[]).map(text).filter(Boolean)
          : [];
        if (claimIds.length === 0) {
          return NextResponse.json(
            { success: false, error: "Provide at least one claim id" },
            { status: 400 },
          );
        }
        const amounts = Array.isArray(body.applied_amounts)
          ? (body.applied_amounts as unknown[]).map(money)
          : [];

        // Confirm claims belong to org.
        const { data: claimCheck, error: ccErr } = await (supabase as any)
          .from("professional_claims")
          .select("id")
          .eq("organization_id", organizationId)
          .in("id", claimIds);
        if (ccErr) throw ccErr;
        const validIds = new Set(((claimCheck ?? []) as DbRow[]).map((c) => text(c.id)));
        const rows = claimIds
          .filter((id) => validIds.has(id))
          .map((id, idx) => ({
            organization_id: organizationId,
            paper_check_id: checkId,
            claim_id: id,
            applied_amount: amounts[idx] ?? 0,
            matched_by_user_id: guard.userId,
          }));
        if (rows.length === 0) {
          return NextResponse.json(
            { success: false, error: "No valid claims to match" },
            { status: 400 },
          );
        }
        const { error: insErr } = await (supabase as any)
          .from("paper_check_claim_matches")
          .upsert(rows, { onConflict: "paper_check_id,claim_id" });
        if (insErr) throw insErr;
        // If the check was unmatched, move it to deposited (or keep posted).
        if (existing.posting_status === "unmatched") {
          patch = { posting_status: existing.posting_status === "posted" ? "posted" : "deposited" };
        }
        eventMessage = `Matched ${rows.length} claim(s)`;
        eventPayload.claim_ids = rows.map((r) => r.claim_id);
        break;
      }
      case "resolve_mismatch": {
        const resolution = text(body.resolution);
        if (!["returned", "void", "unmatched"].includes(resolution)) {
          return NextResponse.json(
            { success: false, error: "Invalid resolution" },
            { status: 400 },
          );
        }
        patch = { posting_status: resolution };
        eventMessage = `Marked ${resolution}`;
        if (typeof body.note === "string" && body.note.trim()) {
          eventPayload.note = body.note.trim();
        }
        break;
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await (supabase as any)
        .from("paper_checks")
        .update(patch)
        .eq("id", checkId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;
    }

    await (supabase as any).from("paper_check_events").insert({
      organization_id: organizationId,
      paper_check_id: checkId,
      event_type: action,
      message: eventMessage,
      actor_user_id: guard.userId,
      payload: Object.keys(eventPayload).length ? eventPayload : null,
    });

    // Return the updated check + matches so the client can patch in place.
    const [{ data: updated }, { data: matches }] = await Promise.all([
      (supabase as any)
        .from("paper_checks")
        .select(
          "id, posting_status, deposit_date, deposit_notes, paper_eob_url, scanned_check_url, updated_at",
        )
        .eq("id", checkId)
        .eq("organization_id", organizationId)
        .single(),
      (supabase as any)
        .from("paper_check_claim_matches")
        .select("paper_check_id, claim_id, applied_amount")
        .eq("organization_id", organizationId)
        .eq("paper_check_id", checkId),
    ]);

    return NextResponse.json({ success: true, check: updated, matches: matches ?? [] });
  } catch (error) {
    console.error("Paper checks action error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Action failed",
      },
      { status: 500 },
    );
  }
}
