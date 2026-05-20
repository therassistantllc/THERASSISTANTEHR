-- Adds a flag indicating that this payer requires a prior-authorization
-- number on every claim. Consumed by the Claim Content Validation engine
-- (lib/validation/claim/*) and surfaced through the same claim-submission
-- gate that drives the Claim Readiness panel.
ALTER TABLE payer_profiles
  ADD COLUMN IF NOT EXISTS requires_authorization boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN payer_profiles.requires_authorization IS
  'When true, the Claim Content Validator emits a blocking finding for any claim to this payer that lacks professional_claims.prior_authorization_number.';
