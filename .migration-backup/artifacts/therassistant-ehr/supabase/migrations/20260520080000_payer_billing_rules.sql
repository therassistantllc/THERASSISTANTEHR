-- Payer-specific billing rules.
--
-- Stored as a single jsonb blob on payer_profiles so the rule set can grow
-- without further migrations. Consumed by the Claim Content Validation engine
-- (lib/validation/claim/*) and surfaced through the same combined claim
-- submission gate that already enforces system-readiness + content rules.
--
-- Shape (all fields optional; absent = rule off):
--   {
--     "requires_telehealth_modifier":        boolean,
--     "allowed_pos_codes":                   string[],   // empty/null = any POS allowed
--     "requires_rendering_provider_taxonomy":boolean,
--     "requires_subscriber_relationship":    boolean,
--     "timely_filing_days":                  integer,    // null = no limit
--     "allowed_cpt_codes":                   string[],   // empty/null = any CPT allowed
--     "denied_cpt_codes":                    string[]    // empty/null = none denied
--   }
--
-- `requires_authorization` continues to live in its own dedicated column
-- (added in 20260520060000_payer_requires_authorization.sql) so existing rule
-- code paths are not disturbed.

ALTER TABLE public.payer_profiles
  ADD COLUMN IF NOT EXISTS billing_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.payer_profiles.billing_rules IS
  'Payer-specific billing rule flags consumed by lib/validation/claim. See migration 20260520080000_payer_billing_rules.sql for shape.';

SELECT pg_notify('pgrst', 'reload schema');
