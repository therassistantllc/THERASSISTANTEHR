import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import { mapJournalRow } from "@/lib/portal/journal";

type Row = Record<string, unknown>;

function value(v: unknown) {
  return String(v ?? "").trim();
}

/**
 * Clinician view of a patient's journal entries.
 *
 * Auth: requires an authenticated staff session in the same organization
 * (requireOrgAccess). The session-derived `organizationId` is the source of
 * truth — any `organizationId` query param is only used to detect a mismatch
 * and reject the call.
 *
 * Query params:
 *   organizationId       optional; must equal the session org if supplied.
 *   since                optional ISO timestamp — only entries created at/
 *                        after this are returned.
 *   windowSinceLastSigned "1" → server looks up the most recent signed
 *                        clinical note for this client and uses its
 *                        signed_at as `since`. Combined with
 *                        `excludeEncounterId`, this gives the natural
 *                        "between-session" window for an in-progress
 *                        encounter.
 *   excludeEncounterId   when computing windowSinceLastSigned, ignore notes
 *                        attached to this encounter (the one currently
 *                        being edited).
 *   onlyUnimported       "1" → filter to entries not yet imported into a
 *                        SOAP note (used by the import picker).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await context.params;
  const url = new URL(request.url);
  const requested = value(url.searchParams.get("organizationId"));
  const guard = await requireOrgAccess({
    requestedOrganizationId: requested || null,
    permission: "view_patient_chart",
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

  if (!clientId) {
    return NextResponse.json(
      { success: false, error: "clientId is required" },
      { status: 400 },
    );
  }
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
  }

  // Confirm the client really belongs to the caller's org before exposing
  // their journal — avoids leaking even the existence of a chart in another
  // organization via timing or empty-list responses.
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
  }

  let since = value(url.searchParams.get("since"));
  const windowSinceLastSigned = value(url.searchParams.get("windowSinceLastSigned")) === "1";
  const excludeEncounterId = value(url.searchParams.get("excludeEncounterId"));
  const onlyUnimported = value(url.searchParams.get("onlyUnimported")) === "1";

  if (windowSinceLastSigned) {
    let q = supabase
      .from("encounter_clinical_notes")
      .select("signed_at, encounter_id, encounters!inner(client_id, organization_id)")
      .eq("encounters.client_id", clientId)
      .eq("encounters.organization_id", organizationId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1);
    if (excludeEncounterId) q = q.neq("encounter_id", excludeEncounterId);
    const { data: prev } = await q.maybeSingle();
    const prevSigned = value((prev as Row | null)?.signed_at);
    if (prevSigned) since = prevSigned;
  }

  let query = supabase
    .from("patient_journal_entries")
    .select(
      "id, entry_type, body, tags, audio_storage_path, audio_mime_type, audio_duration_seconds, imported_into_note_id, imported_into_field, imported_at, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (since) query = query.gte("created_at", since);
  if (onlyUnimported) query = query.is("imported_into_note_id", null);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    since: since || null,
    entries: ((data ?? []) as Row[]).map(mapJournalRow),
  });
}
