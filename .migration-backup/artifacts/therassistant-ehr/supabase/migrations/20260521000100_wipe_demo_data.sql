-- ============================================================================
-- WIPE DEMO / SEED DATA
-- ============================================================================
-- This migration wipes all transactional demo data for the demo organization
-- (`organizations.slug = 'therassistant-demo'`) by calling the centralized
-- FK-safe function `public.clear_org_demo_data(uuid)`.
--
-- Requirements:
--   * `public.clear_org_demo_data(uuid)` must exist
--     (created by 20260605010000_clear_org_demo_data_function.sql).
--
-- Safety:
--   * Scoped to slug `therassistant-demo`.
--   * Wrapped in a transaction.
--   * Keeps organization/config/login rows; removes operational/demo records.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id
    INTO v_org_id
    FROM public.organizations
   WHERE slug = 'therassistant-demo'
   LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found for slug %; nothing to wipe.', 'therassistant-demo';
    RETURN;
  END IF;

  PERFORM public.clear_org_demo_data(v_org_id);
END;
$$;

COMMIT;

-- Storage objects under `mailroom-documents/mailroom/demo/*` must be wiped
-- separately — they live in Supabase Storage, not Postgres. Run from the
-- Supabase dashboard or via the storage API:
--   supabase storage rm --recursive mailroom-documents/mailroom/demo/
