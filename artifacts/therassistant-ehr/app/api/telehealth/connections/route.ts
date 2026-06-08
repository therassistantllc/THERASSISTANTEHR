import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { listConnectionsForUser } from "@/lib/telehealth/connections";
import { getPlatformStatus } from "@/lib/telehealth/config";

export async function GET() {
  const ctx = await requireAuthenticatedStaff();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  try {
    const connections = await listConnectionsForUser(supabase as any, ctx.organizationId, ctx.userId);
    return NextResponse.json({
      success: true,
      platformStatus: {
        zoom: getPlatformStatus("zoom"),
        google_meet: getPlatformStatus("google_meet"),
      },
      connections: connections.map((c) => ({
        platform: c.platform,
        connectionId: c.connectionId,
        accountEmail: c.accountEmail,
        status: c.status,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        lastError: c.lastError,
      })),
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code ?? "";
    const message = e instanceof Error ? e.message : "Failed to load connections";
    if (code === "42P01" && /telehealth_oauth_tokens/i.test(message)) {
      return NextResponse.json({
        success: true,
        degraded: true,
        error:
          "Telehealth OAuth tables not yet provisioned. Apply migration 20260527000000_telehealth_oauth.sql to your Supabase project.",
        platformStatus: {
          zoom: getPlatformStatus("zoom"),
          google_meet: getPlatformStatus("google_meet"),
        },
        connections: [],
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
