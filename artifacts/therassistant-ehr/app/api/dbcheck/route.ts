import { NextResponse } from "next/server";
import pg from "pg";

export const dynamic = "force-dynamic";

function parseSafe(url: string) {
  try {
    const u = new URL(url);
    return {
      protocol: u.protocol,
      userPrefix: u.username ? u.username.slice(0, 12) + "…" : null,
      hasPassword: u.password.length > 0,
      passwordLen: u.password.length,
      passwordHasSpecial: /[^A-Za-z0-9]/.test(u.password),
      host: u.hostname,
      port: u.port,
      database: u.pathname.replace(/^\//, ""),
      search: u.search,
    };
  } catch (e) {
    return { parseError: String((e as Error).message) };
  }
}

function shape(url: string) {
  return {
    length: url.length,
    startsWithPostgres: /^postgres(ql)?:\/\//.test(url),
    hasDoubleSlash: url.includes("//"),
    atCount: (url.match(/@/g) || []).length,
    colonCount: (url.match(/:/g) || []).length,
    hasSpace: /\s/.test(url),
    hasNewline: /[\r\n]/.test(url),
    hasSquareBrackets: /[[\]]/.test(url),
    hasAngleBrackets: /[<>]/.test(url),
    containsYourPassword: /YOUR.?PASSWORD/i.test(url),
    head: url.slice(0, 24),
    tail: url.slice(-34),
  };
}

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  const host = url.match(/@([^/]*)/)?.[1] ?? null;
  const parsed = parseSafe(url);
  const structure = shape(url);
  const attempts: Record<string, unknown> = {};
  const modes: Array<[string, pg.ClientConfig]> = [
    ["plain", { connectionString: url }],
    ["ssl-noverify", { connectionString: url, ssl: { rejectUnauthorized: false } }],
  ];
  for (const [label, cfg] of modes) {
    const c = new pg.Client(cfg);
    try {
      await c.connect();
      const r = await c.query(
        "select count(*)::int n from information_schema.tables where table_schema='public'",
      );
      attempts[label] = { ok: true, publicTables: r.rows[0].n };
      await c.end();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      attempts[label] = {
        ok: false,
        code: err.code,
        msg: String(err.message ?? e).split("\n")[0],
      };
      try {
        await c.end();
      } catch {}
    }
  }
  return NextResponse.json({
    hostMasked: host,
    parsed,
    structure,
    isPooler: /pooler\.supabase\.com/.test(url),
    isDirect: /db\..*\.supabase\.co/.test(url),
    attempts,
  });
}
