import { NextResponse } from "next/server";
import pg from "pg";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  const host = url.match(/@([^/]*)/)?.[1] ?? null;
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
    isPooler: /pooler\.supabase\.com/.test(url),
    isDirect: /db\..*\.supabase\.co/.test(url),
    attempts,
  });
}
