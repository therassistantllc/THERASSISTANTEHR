/**
 * Submission packet builder.
 *
 * Merges the cover-letter PDF with the selected claim attachments into a
 * single PDF file the biller can mail/fax to the payer. Supports PDF and
 * raster image (PNG/JPG) attachments; unsupported types are skipped and
 * reported back to the caller so the UI can surface a clear note.
 */
import { PDFDocument } from "pdf-lib";

export interface PacketAttachmentInput {
  /** Display title used in the skipped-notes message. */
  title: string;
  /** Original file name (used to infer type when mime is missing). */
  fileName: string;
  /** Raw bytes from storage. */
  bytes: Uint8Array;
  /** Content-type from the documents row. */
  mimeType: string | null;
}

export interface PacketAttachmentResult {
  title: string;
  fileName: string;
  /** "pdf" | "image" | "skipped" */
  kind: "pdf" | "image" | "skipped";
  /** When skipped, the reason. */
  reason?: string;
}

export interface SubmissionPacketResult {
  pdfBytes: Uint8Array;
  included: PacketAttachmentResult[];
  skipped: PacketAttachmentResult[];
}

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

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 36;

export async function buildSubmissionPacket(
  coverLetterPdf: Uint8Array,
  attachments: PacketAttachmentInput[],
): Promise<SubmissionPacketResult> {
  const merged = await PDFDocument.create();

  // 1) Cover letter pages first.
  try {
    const cover = await PDFDocument.load(coverLetterPdf);
    const pages = await merged.copyPages(cover, cover.getPageIndices());
    for (const p of pages) merged.addPage(p);
  } catch (e) {
    throw new Error(
      `Failed to load cover letter PDF: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const included: PacketAttachmentResult[] = [];
  const skipped: PacketAttachmentResult[] = [];

  // 2) Each attachment in order.
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

    const imgType = imageKind(att.mimeType, att.fileName);
    if (imgType) {
      try {
        const embedded =
          imgType === "png" ? await merged.embedPng(att.bytes) : await merged.embedJpg(att.bytes);
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

  const out = await merged.save();
  return {
    pdfBytes: out instanceof Uint8Array ? out : new Uint8Array(out),
    included,
    skipped,
  };
}
