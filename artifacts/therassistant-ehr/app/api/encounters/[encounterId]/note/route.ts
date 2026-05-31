import { NextResponse } from "next/server";
import { captureSignedEncounterCharge } from "@/lib/charges/signedEncounterChargeCaptureService";
import { createClaimDraftFromChargeCapture } from "@/lib/claims/chargeCaptureClaimBridgeService";
import { buildTextReportPdf } from "@/lib/pdf/textReportPdf";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type EncounterRow = {
  id: string;
  organization_id: string;
  client_id: string;
  provider_id: string | null;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeToken(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function codingReportTextFromBody(body: Record<string, unknown>): string {
  const report = body.codingReport as Record<string, unknown> | undefined;
  if (!report || typeof report !== "object") return "";

  const reportText = cleanText(report.reportText);
  if (reportText.length) return reportText;

  const sections = Array.isArray(report.detailedSections)
    ? report.detailedSections as Array<Record<string, unknown>>
    : [];

  if (!sections.length) {
    const codes = cleanText(report.codes);
    const rationale = cleanText(report.codingRationale);
    const summary = cleanText(report.auditSummary);
    return [
      codes ? `CODE: ${codes}` : "",
      summary ? `WHY THE CODE IS SUPPORTED: ${summary}` : "",
      rationale ? `SUGGESTED DOCUMENTATION LANGUAGE: ${rationale}` : "",
    ].filter(Boolean).join("\n");
  }

  return sections.map((section) => {
    return [
      `CODE: ${cleanText(section.code) || "Not specified"}`,
      `DESCRIPTION: ${cleanText(section.description) || "Not specified"}`,
      `REIMBURSEMENT RANGE: ${cleanText(section.reimbursementRange) || "Verify payer schedule"}`,
      `WHY THE CODE IS SUPPORTED: ${cleanText(section.whyCodeSupported) || "Not specified"}`,
      `LEGAL CITATIONS: ${cleanText(section.legalCitations) || "Not specified"}`,
      `MEDICAL NECESSITY STANDARD: ${cleanText(section.medicalNecessityStandard) || "Not specified"}`,
      `REQUIRED DOCUMENTATION: ${cleanText(section.requiredDocumentation) || "Not specified"}`,
      `SUGGESTED DOCUMENTATION LANGUAGE: ${cleanText(section.suggestedDocumentationLanguage) || "Not specified"}`,
      `COMMON DEFICIENCIES: ${cleanText(section.commonDeficiencies) || "Not specified"}`,
    ].join("\n");
  }).join("\n\n");
}

async function loadEncounter(organizationId: string, encounterId: string) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("encounters")
    .select("id, organization_id, client_id, provider_id")
    .eq("organization_id", organizationId)
    .eq("id", encounterId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw error;
  return data as EncounterRow | null;
}

export async function POST(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { encounterId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Request body must be valid JSON" }, { status: 400 });
    }
    const organizationId = body.organizationId ? String(body.organizationId) : "";
    const action = body.action ? String(body.action) : "save";
    const userId = body.userId ? String(body.userId) : null;

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    if (!["save", "sign", "amend"].includes(action)) {
      return NextResponse.json({ success: false, error: "action must be save, sign, or amend" }, { status: 400 });
    }

    const encounter = await loadEncounter(organizationId, encounterId);
    if (!encounter) {
      return NextResponse.json({ success: false, error: "Encounter not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    // For "amend", preserve the existing signed status + signed_at; we update
    // SOAP fields in-place on the already-signed note. "save" = draft, "sign"
    // = transition to signed.
    let existingSigned: { signed_at: string | null; signed_by_user_id: string | null } | null = null;
    if (action === "amend") {
      const { data: existingForAmend } = await supabase
        .from("encounter_clinical_notes")
        .select("note_status, signed_at, signed_by_user_id")
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId)
        .is("archived_at", null)
        .maybeSingle();
      if (!existingForAmend || existingForAmend.note_status !== "signed") {
        return NextResponse.json(
          { success: false, error: "Only signed notes can be amended" },
          { status: 409 },
        );
      }
      existingSigned = {
        signed_at: existingForAmend.signed_at,
        signed_by_user_id: existingForAmend.signed_by_user_id,
      };
    }

    const noteStatus = action === "sign" ? "signed" : action === "amend" ? "signed" : "draft";

    const notePayload = {
      organization_id: organizationId,
      encounter_id: encounterId,
      client_id: encounter.client_id,
      provider_id: encounter.provider_id,
      note_status: noteStatus,
      subjective: cleanText(body.subjective),
      objective: cleanText(body.objective),
      assessment: cleanText(body.assessment),
      plan: cleanText(body.plan),
      // Preserve the original signed_at / signed_by exactly on amend — never
      // overwrite with `now`, even if the existing values are null. Sign sets
      // them; save (draft) clears them.
      signed_at: action === "sign" ? now : action === "amend" ? existingSigned!.signed_at : null,
      signed_by_user_id: action === "sign" ? userId : action === "amend" ? existingSigned!.signed_by_user_id : null,
      updated_at: now,
    };

    const selectExistingNote = () =>
      supabase
        .from("encounter_clinical_notes")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("encounter_id", encounterId)
        .is("archived_at", null)
        .maybeSingle();

    const { data: existingNote } = await selectExistingNote();

    let noteId: string | null = null;
    if (existingNote?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("encounter_clinical_notes")
        .update(notePayload)
        .eq("organization_id", organizationId)
        .eq("id", existingNote.id)
        .select("id")
        .single();

      if (updateError || !updated) throw updateError ?? new Error("Failed to update note");
      noteId = String(updated.id);
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("encounter_clinical_notes")
        .insert({ ...notePayload, created_at: now })
        .select("id")
        .single();

      if (inserted) {
        noteId = String(inserted.id);
      } else if ((insertError as { code?: string } | null)?.code === "23505") {
        // Race: another concurrent save inserted the note between our SELECT
        // and INSERT. The partial unique index on (organization_id, encounter_id)
        // WHERE archived_at IS NULL rejected the duplicate; re-select and
        // update the winning row instead of throwing.
        const { data: raceRow } = await selectExistingNote();
        if (!raceRow?.id) throw insertError ?? new Error("Failed to create note");
        const { data: updated, error: updateError } = await supabase
          .from("encounter_clinical_notes")
          .update(notePayload)
          .eq("organization_id", organizationId)
          .eq("id", raceRow.id)
          .select("id")
          .single();
        if (updateError || !updated) throw updateError ?? new Error("Failed to update note after race");
        noteId = String(updated.id);
      } else {
        throw insertError ?? new Error("Failed to create note");
      }
    }

    let chargeCapture = null;
    let claimDraft = null;
    let createdDocuments: Array<{ id: string; type: string; title: string }> = [];
    if (action === "sign") {
      const { error: encounterUpdateError } = await supabase
        .from("encounters")
        .update({
          encounter_status: "signed",
          required_billing_fields_complete: true,
          updated_at: now,
        })
        .eq("organization_id", organizationId)
        .eq("id", encounterId);

      if (encounterUpdateError) throw encounterUpdateError;
      chargeCapture = await captureSignedEncounterCharge({ organizationId, encounterId });

      if (chargeCapture.chargeId && chargeCapture.status === "ready_for_claim") {
        claimDraft = await createClaimDraftFromChargeCapture({
          organizationId,
          chargeCaptureId: chargeCapture.chargeId,
        });
      }

      const signedAt = notePayload.signed_at ?? now;
      const dateToken = signedAt.slice(0, 10);
      const timestamp = Date.now();

      const clinicalLines = [
        `Encounter ID: ${encounterId}`,
        `Note status: signed`,
        `Signed at: ${signedAt}`,
        "",
        "SUBJECTIVE:",
        notePayload.subjective || "Not documented",
        "",
        "OBJECTIVE:",
        notePayload.objective || "Not documented",
        "",
        "ASSESSMENT:",
        notePayload.assessment || "Not documented",
        "",
        "PLAN:",
        notePayload.plan || "Not documented",
      ];

      const clinicalPdfBytes = await buildTextReportPdf({
        title: "Clinical Note",
        subtitle: `Encounter ${encounterId}`,
        generatedAtIso: signedAt,
        lines: clinicalLines,
      });

      const reportText = codingReportTextFromBody(body);
      const codingPdfBytes = await buildTextReportPdf({
        title: "Coding Report",
        subtitle: `Encounter ${encounterId}`,
        generatedAtIso: signedAt,
        lines: reportText.length
          ? reportText.split("\n")
          : [
              "CODE: None generated",
              "DESCRIPTION: Coding helper report was not provided at sign time.",
              "REIMBURSEMENT RANGE: Verify payer-specific fee schedule.",
              "WHY THE CODE IS SUPPORTED: Not enough coding helper evidence was supplied.",
              "LEGAL CITATIONS: HCPCS Level II code set (CMS annual release); payer policy.",
              "MEDICAL NECESSITY STANDARD: Documentation must support service level and necessity.",
              "REQUIRED DOCUMENTATION: Service details, rationale, and payer-required elements.",
              "SUGGESTED DOCUMENTATION LANGUAGE: Add coding helper output before submission when possible.",
              "COMMON DEFICIENCIES: Missing coding helper output; insufficient code-specific rationale.",
            ],
      });

      const uploaderId = userId;
      const storageBase = `encounters/${encounterId}/signed-documents`;
      const uploads = [
        {
          type: "clinical_note",
          title: `Clinical Note ${dateToken}`,
          fileName: `clinical-note-${dateToken}-${safeToken(noteId || encounterId || "note") || "note"}.pdf`,
          bytes: clinicalPdfBytes,
          notes: "Signed encounter clinical note PDF.",
        },
        {
          type: "coding_report",
          title: `Coding Report ${dateToken}`,
          fileName: `coding-report-${dateToken}-${safeToken(noteId || encounterId || "report") || "report"}.pdf`,
          bytes: codingPdfBytes,
          notes: "Signed encounter coding report PDF.",
        },
      ];

      for (const upload of uploads) {
        const storagePath = `${storageBase}/${timestamp}-${upload.fileName}`;
        const { error: uploadError } = await supabase.storage
          .from("mailroom-documents")
          .upload(storagePath, upload.bytes, {
            contentType: "application/pdf",
            upsert: false,
          });

        if (uploadError) {
          throw new Error(`Failed to store ${upload.type} PDF: ${uploadError.message}`);
        }

        const { data: insertedDoc, error: docInsertError } = await supabase
          .from("documents")
          .insert({
            organization_id: organizationId,
            encounter_id: encounterId,
            client_id: encounter.client_id,
            document_scope: "encounter",
            document_type: upload.type,
            title: upload.title,
            file_name: upload.fileName,
            mime_type: "application/pdf",
            storage_bucket: "mailroom-documents",
            storage_path: storagePath,
            file_size_bytes: upload.bytes.length,
            notes: upload.notes,
            filed_at: signedAt,
            uploaded_by_user_id: uploaderId,
          })
          .select("id, title, document_type")
          .single();

        if (docInsertError || !insertedDoc) {
          throw docInsertError ?? new Error(`Failed to create ${upload.type} document record`);
        }

        createdDocuments.push({
          id: String(insertedDoc.id),
          type: String(insertedDoc.document_type ?? upload.type),
          title: String(insertedDoc.title ?? upload.title),
        });
      }
    } else if (action === "save") {
      await supabase
        .from("encounters")
        .update({ encounter_status: "draft", updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", encounterId);
    } else if (action === "amend") {
      // Note remains signed; just bump updated_at on the encounter so the
      // chart reflects the amendment time. Do NOT re-run charge capture or
      // create a new claim draft — those were handled at original sign time.
      await supabase
        .from("encounters")
        .update({ updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", encounterId);
    }

    return NextResponse.json({
      success: true,
      noteId,
      encounterId,
      status: noteStatus,
      chargeCapture,
      claimDraft,
      createdDocuments,
    });
  } catch (error) {
    console.error("Encounter note API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Encounter note action failed" },
      { status: 500 },
    );
  }
}
