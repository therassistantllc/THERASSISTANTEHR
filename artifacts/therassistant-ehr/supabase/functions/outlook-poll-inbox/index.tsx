// @ts-expect-error - Deno edge runtime URL import is valid at runtime but not resolvable by this TS config.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-expect-error - Deno npm: specifier is valid at runtime but not resolvable by this TS config.
import { createClient } from "npm:@supabase/supabase-js@2";

const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID")!;
const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
const MICROSOFT_TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") || "common";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope:
          "openid email profile offline_access User.Read Mail.ReadWrite Mail.Send",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Refresh token failed: ${await res.text()}`);
  }
  return await res.json();
}

async function graphGet(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Graph GET failed ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

function parseEmailAddress(emailAddress: { name?: string; address?: string } | null | undefined) {
  if (!emailAddress) return { name: null as string | null, email: "" };
  return {
    name: emailAddress.name?.trim() || null,
    email: (emailAddress.address || "").trim().toLowerCase(),
  };
}

serve(async () => {
  const result = {
    checked_connections: 0,
    routed_messages: 0,
    errors: [] as string[],
  };

  const { data: connections, error: connError } = await supabase
    .from("integration_connections")
    .select(`
      id,
      organization_id,
      external_account_email,
      last_history_id,
      outlook_oauth_tokens!inner(refresh_token)
    `)
    .eq("integration_type", "outlook")
    .eq("connection_status", "connected");

  if (connError) {
    return Response.json({ error: connError.message }, { status: 500 });
  }

  for (const connection of connections ?? []) {
    result.checked_connections += 1;

    try {
      // deno-lint-ignore no-explicit-any
      const tokenRow: any = Array.isArray(connection.outlook_oauth_tokens)
        ? connection.outlook_oauth_tokens[0]
        : connection.outlook_oauth_tokens;
      if (!tokenRow?.refresh_token) {
        throw new Error("Missing Outlook refresh token");
      }

      const token = await refreshAccessToken(tokenRow.refresh_token);
      const accessToken = token.access_token;

      // Use Graph delta on the inbox. last_history_id stores the deltaLink
      // (full URL) from the previous run. First run: start a fresh delta query
      // and only ingest the most recent N messages.
      let pageUrl: string;
      if (connection.last_history_id) {
        pageUrl = connection.last_history_id;
      } else {
        pageUrl =
          "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta?$top=10&$select=id,conversationId,subject,from,toRecipients,bodyPreview,receivedDateTime,internetMessageHeaders";
      }

      let newDeltaLink: string | null = null;
      // Walk all @odata.nextLink pages then capture @odata.deltaLink.
      // Safety cap to avoid runaway pagination.
      for (let i = 0; i < 20; i += 1) {
        const page = await graphGet(pageUrl, accessToken);
        for (const message of page.value ?? []) {
          // deno-lint-ignore no-explicit-any
          const m: any = message;
          if (m["@removed"]) continue; // tombstone — skip
          const from = parseEmailAddress(m.from?.emailAddress);
          const toRaw = (m.toRecipients ?? [])
            // deno-lint-ignore no-explicit-any
            .map((r: any) => r?.emailAddress?.address)
            .filter(Boolean)
            .join(", ") || null;
          const receivedAt = m.receivedDateTime
            ? new Date(m.receivedDateTime).toISOString()
            : new Date().toISOString();

          const headersMap: Record<string, string> = {};
          for (const h of m.internetMessageHeaders ?? []) {
            if (h?.name) headersMap[h.name] = h.value ?? "";
          }

          const { error: rpcError } = await supabase.rpc(
            "route_inbound_gmail_message",
            {
              // The RPC is named gmail-* historically but is provider-agnostic
              // for inbound mail routing. Provider distinguished via metadata.
              p_organization_id: connection.organization_id,
              p_integration_connection_id: connection.id,
              p_gmail_message_id: m.id, // doubles as graph message id
              p_gmail_thread_id: m.conversationId ?? null,
              p_gmail_history_id: "",
              p_from_email: from.email,
              p_from_name: from.name,
              p_to_email: toRaw,
              p_subject: m.subject ?? null,
              p_snippet: m.bodyPreview ?? "",
              p_received_at: receivedAt,
              p_raw_headers: headersMap,
              p_raw_payload: m,
            },
          );

          if (rpcError) throw rpcError;
          result.routed_messages += 1;
        }

        if (page["@odata.nextLink"]) {
          pageUrl = page["@odata.nextLink"];
          continue;
        }
        if (page["@odata.deltaLink"]) {
          newDeltaLink = page["@odata.deltaLink"];
        }
        break;
      }

      // NOTE: the `route_inbound_gmail_message` RPC may stamp `provider='gmail'`
      // by default. We intentionally do NOT issue a bulk UPDATE here to flip it
      // to 'outlook' — that would race with concurrent Gmail polls for the same
      // org. The authoritative provider for a row is derivable from the join
      // `inbound_email_messages.integration_connection_id ->
      //  integration_connections.integration_type`. If a provider column on
      // the row is strictly required, update the RPC to accept a p_provider
      // argument in a follow-up migration.

      await supabase
        .from("integration_connections")
        .update({
          last_history_id: newDeltaLink,
          last_sync_at: new Date().toISOString(),
          sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      result.errors.push(`${connection.external_account_email}: ${message}`);
      await supabase
        .from("integration_connections")
        .update({
          sync_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
    }
  }

  return Response.json(result);
});
