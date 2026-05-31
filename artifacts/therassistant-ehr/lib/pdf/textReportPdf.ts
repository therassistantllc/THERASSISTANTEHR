import { PDFDocument, StandardFonts } from "pdf-lib";

type BuildTextReportPdfInput = {
  title: string;
  subtitle?: string;
  generatedAtIso?: string;
  lines: string[];
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 52;
const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 10;
const BODY_SIZE = 10;
const BODY_LINE_HEIGHT = 14;

function sanitizeLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trimEnd();
}

function splitIntoParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  for (const rawLine of lines) {
    const normalized = sanitizeLine(rawLine);
    if (!normalized) {
      paragraphs.push("");
      continue;
    }
    const parts = normalized.split("\n").map((part) => part.trimEnd());
    paragraphs.push(...parts);
  }
  return paragraphs;
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  widthOfText: (value: string) => number,
): string[] {
  if (!paragraph.trim()) return [""];

  const words = paragraph.trim().split(/\s+/);
  const rows: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (widthOfText(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (!current) {
      let partial = "";
      for (const ch of word) {
        const maybe = `${partial}${ch}`;
        if (widthOfText(maybe) <= maxWidth) {
          partial = maybe;
        } else {
          if (partial) rows.push(partial);
          partial = ch;
        }
      }
      current = partial;
    } else {
      rows.push(current);
      current = word;
    }
  }

  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

export async function buildTextReportPdf(input: BuildTextReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textWidth = PAGE_WIDTH - MARGIN_X * 2;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN_TOP;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight >= MARGIN_BOTTOM) return;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN_TOP;
  };

  page.drawText(input.title.trim() || "Clinical Document", {
    x: MARGIN_X,
    y: cursorY,
    size: TITLE_SIZE,
    font: bold,
  });
  cursorY -= 24;

  const subtitleParts = [
    input.subtitle?.trim() || "",
    input.generatedAtIso ? `Generated: ${input.generatedAtIso}` : "",
  ].filter(Boolean);
  if (subtitleParts.length) {
    page.drawText(subtitleParts.join(" | "), {
      x: MARGIN_X,
      y: cursorY,
      size: SUBTITLE_SIZE,
      font,
    });
    cursorY -= 20;
  }

  const paragraphs = splitIntoParagraphs(input.lines);
  const widthOfBodyText = (value: string) => font.widthOfTextAtSize(value, BODY_SIZE);

  for (const paragraph of paragraphs) {
    const wrapped = wrapParagraph(paragraph, textWidth, widthOfBodyText);
    for (const line of wrapped) {
      ensureSpace(BODY_LINE_HEIGHT);
      page.drawText(line, {
        x: MARGIN_X,
        y: cursorY,
        size: BODY_SIZE,
        font,
      });
      cursorY -= BODY_LINE_HEIGHT;
    }
  }

  const bytes = await pdf.save();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}
