-- Outlook (Microsoft Graph) OAuth token storage.
-- Mirrors the structure of gmail_oauth_tokens so the polling and refresh
-- logic in supabase/functions/outlook-poll-inbox is symmetric with Gmail.

CREATE TABLE IF NOT EXISTS public.outlook_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_connection_id uuid NOT NULL UNIQUE
    REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  email text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_type text,
  scope text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outlook_oauth_tokens_org_idx
  ON public.outlook_oauth_tokens (organization_id);

-- Inbound_email_messages already has a `provider` column (free-text). We
-- intentionally do NOT add an Outlook-specific message-id column; the existing
-- `gmail_message_id` column doubles as the provider message id (Graph returns
-- its own opaque ID which is stored there). If you want strictly clean schema,
-- rename the column later — for now, the field name is just a misnomer.

-- RLS: restrict to service-role only. Tokens are never read from the client.
ALTER TABLE public.outlook_oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlook_oauth_tokens_service_role_only ON public.outlook_oauth_tokens;
CREATE POLICY outlook_oauth_tokens_service_role_only
  ON public.outlook_oauth_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
