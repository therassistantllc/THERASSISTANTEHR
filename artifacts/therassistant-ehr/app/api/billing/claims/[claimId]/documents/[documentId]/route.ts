/**
 * DELETE /api/billing/claims/[claimId]/documents/[documentId]
 *
 * Soft-archives a claim-linked document so it disappears from the
 * Medical Review "Uploaded documents" list (the underlying storage
 * object is left in place for compliance/history). Writes an audit
 * log entry so the action shows up in the claim's submission history.
 *
 * PATCH /api/billing/claims/[claimId]/documents/[documentId]
 *
 * Lets a biller rename a claim-linked document and/or change its
 * document_type without having to delete-and-reupload (Task #640).
 * Scoped to the caller's organization + claim and writes an audit log
 * entry so the rename shows up in the claim's submission history.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ claimId: string; documentId: string }> },
) {
  try {
    const { claimId, documentId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    if (!claimId || !documentId) {
      return NextResponse.json(
        { success: false, error: "claimId and documentId are required" },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };

    const { data: doc, error: docErr } = await sb
      .from("documents")
      .select("id, title, file_name, client_id, claim_id, archived_at")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .maybeSingle();

    if (docErr) {
      return NextResponse.json(
        { success: false, error: docErr.message ?? "Failed to look up document" },
        { status: 500 },
      );
    }
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 },
      );
    }
    if (doc.archived_at) {
      return NextResponse.json({ success: true, alreadyArchived: true });
    }

    const now = new Date().toISOString();
    const { error: updErr } = await sb
      .from("documents")
      .update({ archived_at: now, updated_at: now })
      .eq("id", documentId)
      .eq("organization_id", organizationId);

    if (updErr) {
      return NextResponse.json(
        { success: false, error: updErr.message ?? "Failed to archive document" },
        { status: 500 },
      );
    }

    try {
      await sb.from("audit_logs").insert({
        organization_id: organizationId,
        user_id: userId,
        action: "medical_review_document_removed",
        event_type: "medical_review_workqueue",
        event_summary: `Removed document "${doc.title || doc.file_name || "Document"}" from claim`,
        event_metadata: {
          documentId,
          title: doc.title ?? null,
          fileName: doc.file_name ?? null,
        },
        claim_id: claimId,
        patient_id: (doc.client_id as string | null) ?? null,
        object_type: "professional_claim",
        object_id: claimId,
      });
    } catch (err) {
      console.warn("[claim-documents.delete] audit-failed", err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to remove document",
      },
      { status: 500 },
    );
  }
}

const MAX_TITLE_LEN = 200;
const MAX_DOC_TYPE_LEN = 64;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ claimId: string; documentId: string }> },
) {
  try {
    const { claimId, documentId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    if (!claimId || !documentId) {
      return NextResponse.json(
        { success: false, error: "claimId and documentId are required" },
        { status: 400 },
      );
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }
    const payload = (body ?? {}) as Record<string, unknown>;

    const hasTitleField = Object.prototype.hasOwnProperty.call(payload, "title");
    const hasDocTypeField = Object.prototype.hasOwnProperty.call(
      payload,
      "documentType",
    );
    if (!hasTitleField && !hasDocTypeField) {
      return NextResponse.json(
        {
          success: false,
          error: "Provide at least one of title or documentType",
        },
        { status: 400 },
      );
    }

    let nextTitle: string | undefined;
    if (hasTitleField) {
      const raw = payload.title;
      if (raw !== null && typeof raw !== "string") {
        return NextResponse.json(
          { success: false, error: "title must be a string" },
          { status: 400 },
        );
      }
      const trimmed = (raw ?? "").toString().trim();
      if (!trimmed) {
        return NextResponse.json(
          { success: false, error: "title cannot be blank" },
          { status: 400 },
        );
      }
      if (trimmed.length > MAX_TITLE_LEN) {
        return NextResponse.json(
          { success: false, error: `title must be ${MAX_TITLE_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      nextTitle = trimmed;
    }

    let nextDocType: string | null | undefined;
    if (hasDocTypeField) {
      const raw = payload.documentType;
      if (raw === null) {
        nextDocType = null;
      } else if (typeof raw !== "string") {
        return NextResponse.json(
          { success: false, error: "documentType must be a string or null" },
          { status: 400 },
        );
      } else {
        const trimmed = raw.trim();
        if (!trimmed) {
          nextDocType = null;
        } else if (trimmed.length > MAX_DOC_TYPE_LEN) {
          return NextResponse.json(
            { success: false, error: `documentType must be ${MAX_DOC_TYPE_LEN} characters or fewer` },
            { status: 400 },
          );
        } else {
          nextDocType = trimmed;
        }
      }
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };

    const { data: doc, error: docErr } = await sb
      .from("documents")
      .select("id, title, file_name, document_type, client_id, claim_id, archived_at")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .maybeSingle();

    if (docErr) {
      return NextResponse.json(
        { success: false, error: docErr.message ?? "Failed to look up document" },
        { status: 500 },
      );
    }
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 },
      );
    }
    if (doc.archived_at) {
      return NextResponse.json(
        { success: false, error: "Document has been removed and cannot be edited" },
        { status: 409 },
      );
    }

    const prevTitle = (doc.title as string | null) ?? null;
    const prevDocType = (doc.document_type as string | null) ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (nextTitle !== undefined && nextTitle !== prevTitle) {
      updates.title = nextTitle;
    }
    if (nextDocType !== undefined && nextDocType !== prevDocType) {
      updates.document_type = nextDocType;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: true,
        unchanged: true,
        document: {
          id: documentId,
          title: prevTitle,
          documentType: prevDocType,
        },
      });
    }

    const now = new Date().toISOString();
    updates.updated_at = now;

    const { data: updated, error: updErr } = await sb
      .from("documents")
      .update(updates)
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .select("id, title, document_type")
      .maybeSingle();

    if (updErr) {
      return NextResponse.json(
        { success: false, error: updErr.message ?? "Failed to update document" },
        { status: 500 },
      );
    }

    const newTitle = (updated?.title as string | null) ?? nextTitle ?? prevTitle;
    const newDocType =
      (updated?.document_type as string | null | undefined) ??
      (nextDocType === undefined ? prevDocType : nextDocType);

    try {
      const changedFields: string[] = [];
      if ("title" in updates) changedFields.push("title");
      if ("document_type" in updates) changedFields.push("document_type");
      await sb.from("audit_logs").insert({
        organization_id: organizationId,
        user_id: userId,
        action: "medical_review_document_updated",
        event_type: "medical_review_workqueue",
        event_summary: `Updated document "${newTitle || doc.file_name || "Document"}" (${changedFields.join(", ")})`,
        event_metadata: {
          documentId,
          fileName: (doc.file_name as string | null) ?? null,
          changedFields,
          previous: { title: prevTitle, documentType: prevDocType },
          next: { title: newTitle, documentType: newDocType ?? null },
        },
        claim_id: claimId,
        patient_id: (doc.client_id as string | null) ?? null,
        object_type: "professional_claim",
        object_id: claimId,
      });
    } catch (err) {
      console.warn("[claim-documents.patch] audit-failed", err);
    }

    return NextResponse.json({
      success: true,
      document: {
        id: documentId,
        title: newTitle,
        documentType: newDocType ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update document",
      },
      { status: 500 },
    );
  }
}
