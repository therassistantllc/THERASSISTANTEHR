/**
 * Vision-based insurance-card parser.
 *
 * Given the front (and optional back) of a member's insurance card,
 * returns a structured suggestion — payer name, member id, group #,
 * plan name, subscriber name, RX bin/pcn — plus a per-field
 * confidence score (0..1) so the COB review UI can decide whether to
 * pre-fill a draft policy or just surface the raw image to the
 * biller.
 *
 * Uses the OpenAI Responses API via the Replit AI Integrations proxy
 * (see .local/skills/ai-integrations-openai). Falls back cleanly when
 * the proxy env vars are missing OR the model call fails — callers
 * should treat a null return as "no auto-fill available, biller will
 * key from the image".
 */
type CardSide = {
  bytes: Buffer;
  contentType: string;
};

export type CardSuggestion = {
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

const SYSTEM_PROMPT =
  "You are an insurance-card OCR helper for a behavioral-health EHR billing " +
  "team. You will be given one or two photos of a member's insurance card " +
  "(front, optionally back). Extract structured fields exactly as printed. " +
  "If a field is illegible, missing, or you are not confident, return null " +
  "for that field and a low confidence score (0..1). Never invent fields. " +
  "Return JSON only.";

const USER_PROMPT =
  "Extract: payer_name (e.g. 'Aetna', 'Blue Cross Blue Shield of Texas'), " +
  "member_id (sometimes labeled 'Member ID', 'Subscriber ID', or 'ID #'), " +
  "group_number (often 'Group', 'Group #', 'GRP'), plan_name (e.g. 'PPO', " +
  "'HMO Choice Plus'), subscriber_name (the name printed on the card), " +
  "rx_bin, rx_pcn (pharmacy benefit IDs on the back), payer_phone (member " +
  "services number). Set each confidence to your honest 0..1 belief that " +
  "the value is correct and complete. `overall` is the lowest of the four " +
  "key-field confidences. `raw_text` is a short transcription of anything " +
  "else that looked like an ID/number on the card so a biller can sanity " +
  "check.";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    payer_name: { type: ["string", "null"] },
    member_id: { type: ["string", "null"] },
    group_number: { type: ["string", "null"] },
    plan_name: { type: ["string", "null"] },
    subscriber_name: { type: ["string", "null"] },
    rx_bin: { type: ["string", "null"] },
    rx_pcn: { type: ["string", "null"] },
    payer_phone: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        payer_name: { type: "number" },
        member_id: { type: "number" },
        group_number: { type: "number" },
        plan_name: { type: "number" },
        overall: { type: "number" },
      },
      required: [
        "payer_name",
        "member_id",
        "group_number",
        "plan_name",
        "overall",
      ],
    },
    raw_text: { type: ["string", "null"] },
  },
  required: [
    "payer_name",
    "member_id",
    "group_number",
    "plan_name",
    "subscriber_name",
    "rx_bin",
    "rx_pcn",
    "payer_phone",
    "notes",
    "confidence",
    "raw_text",
  ],
} as const;

function readOutputText(json: unknown): string | null {
  const j = json as Record<string, unknown> | null;
  if (!j) return null;
  if (typeof j.output_text === "string") return j.output_text as string;
  const out = Array.isArray(j.output) ? (j.output as unknown[]) : [];
  for (const item of out) {
    const content =
      item && typeof item === "object"
        ? ((item as Record<string, unknown>).content as unknown[] | undefined)
        : undefined;
    for (const c of content ?? []) {
      const obj = c as Record<string, unknown>;
      if (obj?.type === "output_text" && typeof obj.text === "string") {
        return obj.text as string;
      }
    }
  }
  return null;
}

function clamp(n: unknown, fallback = 0): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, v));
}

function normalize(raw: unknown): CardSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c =
    (r.confidence as Record<string, unknown> | undefined) ?? {};
  const strOrNull = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  return {
    payer_name: strOrNull(r.payer_name),
    member_id: strOrNull(r.member_id),
    group_number: strOrNull(r.group_number),
    plan_name: strOrNull(r.plan_name),
    subscriber_name: strOrNull(r.subscriber_name),
    rx_bin: strOrNull(r.rx_bin),
    rx_pcn: strOrNull(r.rx_pcn),
    payer_phone: strOrNull(r.payer_phone),
    notes: strOrNull(r.notes),
    confidence: {
      payer_name: clamp(c.payer_name),
      member_id: clamp(c.member_id),
      group_number: clamp(c.group_number),
      plan_name: clamp(c.plan_name),
      overall: clamp(c.overall),
    },
    raw_text: strOrNull(r.raw_text),
  };
}

export async function parseInsuranceCard(args: {
  front: CardSide;
  back: CardSide | null;
}): Promise<CardSuggestion | null> {
  const baseUrl =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1";
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const toDataUrl = (s: CardSide) =>
    `data:${s.contentType};base64,${s.bytes.toString("base64")}`;
  const imageInputs: Array<{ type: "input_image"; image_url: string }> = [
    { type: "input_image", image_url: toDataUrl(args.front) },
  ];
  if (args.back) {
    imageInputs.push({ type: "input_image", image_url: toDataUrl(args.back) });
  }

  const body = {
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [{ type: "input_text", text: USER_PROMPT }, ...imageInputs],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "insurance_card_suggestion",
        schema: OUTPUT_SCHEMA,
      },
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) {
      console.warn(
        "parseInsuranceCard: vision call failed",
        res.status,
        (await res.text()).slice(0, 400),
      );
      return null;
    }
    const json = await res.json();
    const text = readOutputText(json);
    if (!text) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    return normalize(parsed);
  } catch (err) {
    console.warn(
      "parseInsuranceCard: error",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export const CARD_SUGGESTION_MIN_CONFIDENCE = 0.55;

export function suggestionIsConfident(s: CardSuggestion | null | undefined) {
  if (!s) return false;
  // We require both member id and payer name to be reasonably solid
  // before we even consider this a usable draft — the biller can
  // still see a low-confidence parse but it won't be flagged as
  // "ready to accept".
  return (
    !!s.payer_name &&
    !!s.member_id &&
    s.confidence.payer_name >= CARD_SUGGESTION_MIN_CONFIDENCE &&
    s.confidence.member_id >= CARD_SUGGESTION_MIN_CONFIDENCE
  );
}
