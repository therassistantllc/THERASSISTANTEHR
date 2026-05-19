import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return NextResponse.json({
    urlLength: url.length,
    urlPrefix: url.substring(0, 10),
    urlValid: /^https?:\/\//.test(url),
    keyLength: key.length,
    keyHasValue: key.length > 0,
  });
}
