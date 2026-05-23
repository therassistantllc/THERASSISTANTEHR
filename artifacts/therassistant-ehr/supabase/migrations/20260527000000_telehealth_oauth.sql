-- Per-clinician telehealth OAuth (Zoom + Google Meet) scaffolding.
-- Reuses the existing integration_connections row (one per (org, integration_type, owner_user_id))
-- and adds a sibling telehealth_oauth_tokens table that mirrors gmail_oauth_tokens.
-- Adds default_telehealth_platform to provider_credentialing_profiles so the
-- adapter layer knows which platform to create meetings on by default.

ALTER TABLE provider_credentialing_profiles
  ADD COLUMN IF NOT EXISTS default_telehealth_platform text
    CHECK (default_telehealth_platform IS NULL OR default_telehealth_platform IN ('zoom', 'google_meet'));

CREATE TABLE IF NOT EXISTS telehealth_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('zoom', 'google_meet')),
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  scope text,
  account_email text,
  expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_connection_id)
);

CREATE INDEX IF NOT EXISTS telehealth_oauth_tokens_org_owner_idx
  ON telehealth_oauth_tokens (organization_id, owner_user_id, platform);
