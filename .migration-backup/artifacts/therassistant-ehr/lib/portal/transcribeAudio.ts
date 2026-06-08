/**
 * Voice-note transcription helper.
 *
 * Sends a stored voice-note audio clip through the OpenAI transcription API
 * (via the Replit AI Integrations proxy when configured, falling back to a
 * direct OPENAI_API_KEY). Returns the transcript string on success or null
 * if the call fails, the env vars are missing, or the model returns no
 * usable text. Callers should treat a null return as "no transcript
 * available" and leave the existing audio-only entry untouched.
 *
 * Used by the portal audio upload route to populate
 * `patient_journal_entries.audio_transcript` after the upload finishes.
 */

const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const MAX_TRANSCRIPT_CHARS = 16000;
const TIMEOUT_MS = 60_000;

function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("mp4")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("aac")) return "aac";
  return "bin";
}

export async function transcribeJournalAudio(args: {
  bytes: Buffer;
  contentType: string;
}): Promise<string | null> {
  const baseUrl =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1";
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!args.bytes || args.bytes.byteLength === 0) return null;

  const mime = (args.contentType || "audio/webm").toLowerCase();
  const filename = `recording.${extFor(mime)}`;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(args.bytes)], { type: mime });
  form.append("file", blob, filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      console.warn(
        "transcribeJournalAudio: failed",
        res.status,
        (await res.text().catch(() => "")).slice(0, 400),
      );
      return null;
    }
    const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof json?.text === "string" ? json.text.trim() : "";
    if (!text) return null;
    return text.length > MAX_TRANSCRIPT_CHARS
      ? text.slice(0, MAX_TRANSCRIPT_CHARS)
      : text;
  } catch (err) {
    console.warn(
      "transcribeJournalAudio: error",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
