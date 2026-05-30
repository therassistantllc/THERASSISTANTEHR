-- Re-apply the demo wipe behavior as a forward migration.
-- The earlier 20260521000100 version is already recorded on remote,
-- so changing that file alone will not deploy the new behavior.

DO $$
DECLARE
  v_org_id uuid;
BEGIN
  IF to_regprocedure('public.clear_org_demo_data(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.clear_org_demo_data(uuid) must exist before running this migration';
  END IF;

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

-- Storage objects under `mailroom-documents/mailroom/demo/*` must be wiped
-- separately — they live in Supabase Storage, not Postgres.