import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TelehealthPlatform } from "./config";

export type OAuthStatePayload = {
  u: string;
  o: string;
  p: TelehealthPlatform;
  pid: string | null;
  n: string;
  e: number;
};

function b64url(buf: Buffer | string): string {
  return (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getStateSecret(): string {
  const secret = process.env.TELEHEALTH_OAUTH_STATE_SECRET ?? process.env.GMAIL_OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error(
      "TELEHEALTH_OAUTH_STATE_SECRET (or GMAIL_OAUTH_STATE_SECRET fallback) is not configured.",
    );
  }
  return secret;
}

export function signOAuthState(input: Omit<OAuthStatePayload, "n" | "e"> & { ttlSeconds?: number }): string {
  const payload: OAuthStatePayload = {
    u: input.u,
    o: input.o,
    p: input.p,
    pid: input.pid,
    n: b64url(randomBytes(12)),
    e: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 600),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", getStateSecret()).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [payloadB64, sig] = state.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = b64url(createHmac("sha256", getStateSecret()).update(payloadB64).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as OAuthStatePayload;
    if (typeof parsed.e !== "number" || parsed.e < Math.floor(Date.now() / 1000)) return null;
    if (parsed.p !== "zoom" && parsed.p !== "google_meet") return null;
    return parsed;
  } catch {
    return null;
  }
}
