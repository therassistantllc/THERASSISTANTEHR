import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";

export async function POST() {
  const ctx = await requireAuthenticatedStaff();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection not available." },
      { status: 500 },
    );
  }

  const { data: connection, error: lookupError } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("integration_type", "gmail")
    .eq("owner_user_id", ctx.userId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: lookupError.message },
      { status: 500 },
    );
  }
  if (!connection) {
    return NextResponse.json({ success: true, alreadyDisconnected: true });
  }

  const { data: tokenRow } = await supabase
    .from("gmail_oauth_tokens")
    .select("refresh_token, access_token")
    .eq("integration_connection_id", connection.id)
    .maybeSingle();

  // Revoke at Google. We attempt refresh_token first (revokes the whole
  // grant); if that fails for any reason fall back to access_token. We do
  // NOT abort the local delete on revoke failure — leaving an orphan row
  // pointing at PHI is worse than leaving a stale Google token behind.
  const tokenToRevoke = tokenRow?.refresh_token ?? tokenRow?.access_token;
  if (tokenToRevoke) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenToRevoke }),
      });
    } catch (err) {
      console.error("Google token revoke failed:", err);
    }
  }

  const { error: tokenDeleteError } = await supabase
    .from("gmail_oauth_tokens")
    .delete()
    .eq("integration_connection_id", connection.id);

  if (tokenDeleteError) {
    return NextResponse.json(
      { error: `Failed to remove stored tokens: ${tokenDeleteError.message}` },
      { status: 500 },
    );
  }

  const { error: connDeleteError } = await supabase
    .from("integration_connections")
    .delete()
    .eq("id", connection.id);

  if (connDeleteError) {
    return NextResponse.json(
      { error: `Failed to remove connection: ${connDeleteError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
