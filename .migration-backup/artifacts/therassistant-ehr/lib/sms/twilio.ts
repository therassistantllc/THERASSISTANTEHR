/**
 * Twilio SMS helper.
 *
 * Mirrors lib/email/resend.ts: credentials come from env first
 * (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) and
 * fall back to the Replit-managed Twilio connector. We call the Twilio
 * REST API directly with fetch so we don't have to add the twilio SDK
 * as a dependency.
 */

const REPLIT_CONNECTORS_HOSTNAME = process.env.REPLIT_CONNECTORS_HOSTNAME;
const X_REPLIT_TOKEN = process.env.REPL_IDENTITY
  ? "repl " + process.env.REPL_IDENTITY
  : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  fromNumber?: string;
};

function readString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

async function fetchTwilioCredentialsFromConnector(): Promise<TwilioCredentials | null> {
  if (!REPLIT_CONNECTORS_HOSTNAME || !X_REPLIT_TOKEN) return null;
  try {
    const response = await fetch(
      `https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names=twilio`,
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN,
        },
      },
    );
    if (!response.ok) return null;
    const json = (await response.json()) as { items?: Array<Record<string, unknown>> };
    const item = json.items?.[0];
    if (!item) return null;
    const settings = (item.settings ?? {}) as Record<string, unknown>;
    const accountSid = readString(settings, "account_sid", "accountSid", "TWILIO_ACCOUNT_SID");
    const authToken = readString(settings, "auth_token", "authToken", "TWILIO_AUTH_TOKEN");
    const fromNumber = readString(
      settings,
      "from_number",
      "fromNumber",
      "phone_number",
      "from",
      "TWILIO_FROM_NUMBER",
    );
    if (!accountSid || !authToken) return null;
    return { accountSid, authToken, fromNumber };
  } catch {
    return null;
  }
}

async function resolveTwilioCredentials(): Promise<TwilioCredentials | null> {
  const envSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const envToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const envFrom = process.env.TWILIO_FROM_NUMBER?.trim();
  if (envSid && envToken) {
    return { accountSid: envSid, authToken: envToken, fromNumber: envFrom || undefined };
  }
  const fromConnector = await fetchTwilioCredentialsFromConnector();
  if (!fromConnector) return null;
  return {
    ...fromConnector,
    fromNumber: fromConnector.fromNumber ?? envFrom,
  };
}

/**
 * Normalize the practice's "phone on file" into something the Twilio API
 * will accept. We don't try to be clever about country codes — if the
 * caller already passed E.164 (+15555550123) we keep it, otherwise we
 * strip formatting and prefix US "+1" for 10-digit numbers. Anything
 * shorter is rejected so we don't silently text the wrong person.
 */
export function normalizePhoneForSms(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export type SendCobUpdateSmsInput = {
  to: string;
  patientName: string;
  practiceName: string;
  updateUrl: string;
};

export type SendCobUpdateSmsResult =
  | { ok: true; providerId: string | null; from: string | null; to: string }
  | { ok: false; error: string };

export async function sendCobUpdateSms(
  input: SendCobUpdateSmsInput,
): Promise<SendCobUpdateSmsResult> {
  const credentials = await resolveTwilioCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "SMS is not configured. Connect Twilio in Integrations (or set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) before texting update links.",
    };
  }

  const from = credentials.fromNumber ?? process.env.TWILIO_FROM_NUMBER?.trim() ?? "";
  if (!from) {
    return {
      ok: false,
      error:
        "Twilio is connected but no sending phone number is set. Configure a Twilio sender (from_number) before texting update links.",
    };
  }

  const normalizedTo = normalizePhoneForSms(input.to);
  if (!normalizedTo) {
    return {
      ok: false,
      error:
        "This client's phone number is missing or unrecognizable. Add a valid phone to the chart, or use email/clipboard instead.",
    };
  }

  const safeName = input.patientName.trim() || "there";
  const safePractice = input.practiceName.trim() || "your care team";
  const body =
    `${safePractice}: Hi ${safeName}, please confirm your insurance so we can bill your recent visit correctly. ` +
    `Open this secure link: ${input.updateUrl} (expires in a few days). Reply STOP to opt out.`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      credentials.accountSid,
    )}/Messages.json`;
    const form = new URLSearchParams();
    form.set("To", normalizedTo);
    form.set("From", from);
    form.set("Body", body);

    const auth = Buffer.from(
      `${credentials.accountSid}:${credentials.authToken}`,
      "utf8",
    ).toString("base64");

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });

    const payload = (await resp.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
      status?: string;
    };

    if (!resp.ok) {
      const detail =
        payload?.message ||
        payload?.status ||
        `Twilio rejected the message (HTTP ${resp.status})`;
      return { ok: false, error: detail };
    }
    return {
      ok: true,
      providerId: typeof payload.sid === "string" ? payload.sid : null,
      from,
      to: normalizedTo,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send SMS";
    return { ok: false, error: message };
  }
}
