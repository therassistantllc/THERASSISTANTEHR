/**
 * Merge a list of attached documents (PDFs + raster images) into one PDF.
 *
 * Used by the outbound fax worker: the medical-review action records
 * `document_ids` against a `claim_documentation_transmissions` row, the
 * worker downloads each file from Supabase storage, and this helper
 * stitches them into the single PDF Telnyx (or any fax provider) actually
 * transmits.
 *
 * Parallel of `buildSubmissionPacket` but without the required cover-letter
 * argument — the fax flow already includes the cover letter (if any) as the
 * first attachment.
 */
import { PDFDocument } from "pdf-lib";

export interface MergeAttachmentInput {
  title: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string | null;
}

export interface MergeAttachmentResult {
  title: string;
  fileName: string;
  kind: "pdf" | "image" | "skipped";
  reason?: string;
}

export interface MergeDocumentsResult {
  pdfBytes: Uint8Array;
  included: MergeAttachmentResult[];
  skipped: MergeAttachmentResult[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 36;

function isPdf(mime: string | null, name: string): boolean {
  if (mime && /pdf/i.test(mime)) return true;
  return /\.pdf$/i.test(name);
}
function imageKind(mime: string | null, name: string): "png" | "jpg" | null {
  const m = (mime ?? "").toLowerCase();
  if (m === "image/png" || /\.png$/i.test(name)) return "png";
  if (m === "image/jpeg" || m === "image/jpg" || /\.jpe?g$/i.test(name)) return "jpg";
  return null;
}

export async function mergeDocumentsToPdf(
  attachments: MergeAttachmentInput[],
): Promise<MergeDocumentsResult> {
  const merged = await PDFDocument.create();
  const included: MergeAttachmentResult[] = [];
  const skipped: MergeAttachmentResult[] = [];

  for (const att of attachments) {
    if (isPdf(att.mimeType, att.fileName)) {
      try {
        const src = await PDFDocument.load(att.bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const p of pages) merged.addPage(p);
        included.push({ title: att.title, fileName: att.fileName, kind: "pdf" });
      } catch (e) {
        skipped.push({
          title: att.title,
          fileName: att.fileName,
          kind: "skipped",
          reason: `Could not parse PDF (${e instanceof Error ? e.message : "unknown"})`,
        });
      }
      continue;
    }
    const img = imageKind(att.mimeType, att.fileName);
    if (img) {
      try {
        const embedded =
          img === "png" ? await merged.embedPng(att.bytes) : await merged.embedJpg(att.bytes);
        const page = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        const maxW = PAGE_WIDTH - PAGE_MARGIN * 2;
        const maxH = PAGE_HEIGHT - PAGE_MARGIN * 2;
        const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        page.drawImage(embedded, {
          x: (PAGE_WIDTH - w) / 2,
          y: (PAGE_HEIGHT - h) / 2,
          width: w,
          height: h,
        });
        included.push({ title: att.title, fileName: att.fileName, kind: "image" });
      } catch (e) {
        skipped.push({
          title: att.title,
          fileName: att.fileName,
          kind: "skipped",
          reason: `Could not embed image (${e instanceof Error ? e.message : "unknown"})`,
        });
      }
      continue;
    }
    skipped.push({
      title: att.title,
      fileName: att.fileName,
      kind: "skipped",
      reason: `Unsupported file type${att.mimeType ? ` (${att.mimeType})` : ""}`,
    });
  }

  if (included.length === 0) {
    // pdf-lib refuses to save a doc with zero pages — add a blank placeholder
    // so the caller can still send a fax that simply says "no renderable
    // attachments" (and the skip reasons will be in the audit log).
    merged.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }

  const out = await merged.save();
  return {
    pdfBytes: out instanceof Uint8Array ? out : new Uint8Array(out),
    included,
    skipped,
  };
}
