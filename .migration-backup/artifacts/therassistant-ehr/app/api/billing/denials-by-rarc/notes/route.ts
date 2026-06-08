/**
 * POST /api/billing/denials-by-rarc/notes
 *
 * Returns the historical resolution log for a RARC code:
 *
 *   - Every claim_notes row tagged with `rarcCode` across the whole
 *     organization (not just the claims currently denied), newest first.
 *   - Legacy notes on the claims in the currently-selected RARC group
 *     that pre-date the rarc_codes column (so they aren't lost).
 *   - Audit events on those same claims (template creates, assignments,
 *     payer-rule updates) so the timeline matches the side actions.
 *
 * When `resolvedOnly` is true the result is narrowed to notes whose
 * author flagged them as the one that closed the denial.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

interface Body {
  organizationId?: string;
  claimIds?: string[];
  rarcCode?: string | null;
  resolvedOnly?: boolean;
}

type Entry = {
  id: string;
  kind: "note" | "audit";
  claimId: string;
  claimNumber: string;
  author: string;
  body: string;
  createdAt: string;
  resolvedDenial: boolean;
  rarcCodes: string[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const claimIds = Array.isArray(body.claimIds)
      ? body.claimIds.map(text).filter(Boolean)
      : [];
    const rarcCode = text(body.rarcCode).toUpperCase();
    const resolvedOnly = Boolean(body.resolvedOnly);

    if (!rarcCode && claimIds.length === 0) {
      return NextResponse.json({ success: true, entries: [] });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    // 1) Notes tagged with this RARC code anywhere in the org. These are
    //    the cross-claim history the detail panel is for.
    const taggedNotesPromise = rarcCode && rarcCode !== "UNSPECIFIED"
      ? (() => {
          let q = (supabase as any)
            .from("claim_notes")
            .select(
              "id, claim_id, body, author_display_name, rarc_codes, resolved_denial, created_at",
            )
            .eq("organization_id", organizationId)
            .overlaps("rarc_codes", [rarcCode])
            .order("created_at", { ascending: false })
            .limit(200);
          if (resolvedOnly) q = q.eq("resolved_denial", true);
          return q;
        })()
      : Promise.resolve({ data: [] as any[] });

    // 2) Legacy notes (no rarc_codes yet) on the claims currently in this
    //    RARC group, so we still surface them.
    const legacyNotesPromise = claimIds.length
      ? (() => {
          let q = (supabase as any)
            .from("claim_notes")
            .select(
              "id, claim_id, body, author_display_name, rarc_codes, resolved_denial, created_at",
            )
            .eq("organization_id", organizationId)
            .in("claim_id", claimIds)
            .or("rarc_codes.is.null,rarc_codes.eq.{}")
            .order("created_at", { ascending: false })
            .limit(200);
          if (resolvedOnly) q = q.eq("resolved_denial", true);
          return q;
        })()
      : Promise.resolve({ data: [] as any[] });

    // 3) Audit log for the in-group claims (template creates, assignments,
    //    payer-rule updates). Suppressed when resolvedOnly is requested —
    //    they aren't "resolution" events.
    const auditsPromise =
      claimIds.length && !resolvedOnly
        ? (supabase as any)
            .from("audit_logs")
            .select("id, claim_id, event_type, event_summary, created_at")
            .eq("organization_id", organizationId)
            .in("claim_id", claimIds)
            .order("created_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] as any[] });

    const [
      { data: taggedNotes },
      { data: legacyNotes },
      { data: audits },
    ] = await Promise.all([taggedNotesPromise, legacyNotesPromise, auditsPromise]);

    // Resolve claim numbers for every claim id referenced above so the
    // detail panel can show "Claim # · author · date".
    const referencedClaimIds = new Set<string>();
    for (const n of (taggedNotes as any[]) ?? []) referencedClaimIds.add(text(n.claim_id));
    for (const n of (legacyNotes as any[]) ?? []) referencedClaimIds.add(text(n.claim_id));
    for (const a of (audits as any[]) ?? []) referencedClaimIds.add(text(a.claim_id));
    for (const cid of claimIds) referencedClaimIds.add(cid);

    let claimNumberById = new Map<string, string>();
    if (referencedClaimIds.size > 0) {
      const { data: claimRows } = await (supabase as any)
        .from("professional_claims")
        .select("id, claim_number")
        .eq("organization_id", organizationId)
        .in("id", Array.from(referencedClaimIds));
      claimNumberById = new Map(
        ((claimRows as any[]) ?? []).map((c) => [text(c.id), text(c.claim_number)]),
      );
    }

    const entries: Entry[] = [];
    const seenNoteIds = new Set<string>();

    function pushNote(n: any) {
      const id = text(n.id);
      if (!id || seenNoteIds.has(id)) return;
      seenNoteIds.add(id);
      entries.push({
        id: `note-${id}`,
        kind: "note",
        claimId: text(n.claim_id),
        claimNumber: claimNumberById.get(text(n.claim_id)) ?? "",
        author: text(n.author_display_name) || "Staff",
        body: text(n.body),
        createdAt: text(n.created_at),
        resolvedDenial: Boolean(n.resolved_denial),
        rarcCodes: Array.isArray(n.rarc_codes) ? n.rarc_codes.map(text) : [],
      });
    }

    for (const n of (taggedNotes as any[]) ?? []) pushNote(n);
    for (const n of (legacyNotes as any[]) ?? []) pushNote(n);

    for (const a of (audits as any[]) ?? []) {
      entries.push({
        id: `audit-${text(a.id)}`,
        kind: "audit",
        claimId: text(a.claim_id),
        claimNumber: claimNumberById.get(text(a.claim_id)) ?? "",
        author: text(a.event_type),
        body: text(a.event_summary),
        createdAt: text(a.created_at),
        resolvedDenial: false,
        rarcCodes: [],
      });
    }

    entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return NextResponse.json({ success: true, entries });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
