-- Per-provider telehealth + Stripe payment link, and copay collection log

ALTER TABLE provider_credentialing_profiles
  ADD COLUMN IF NOT EXISTS telehealth_url text,
  ADD COLUMN IF NOT EXISTS stripe_payment_link_url text;

CREATE TABLE IF NOT EXISTS copay_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  appointment_id uuid,
  client_id uuid,
  provider_id uuid,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL,
  external_reference text,
  stripe_payment_link_url text,
  collected_by_user_id uuid,
  collected_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copay_transactions_org_idx ON copay_transactions (organization_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS copay_transactions_appt_idx ON copay_transactions (appointment_id);
CREATE INDEX IF NOT EXISTS copay_transactions_client_idx ON copay_transactions (client_id);
