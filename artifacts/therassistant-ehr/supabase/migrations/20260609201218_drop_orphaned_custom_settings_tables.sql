-- Drop orphaned custom settings tables if they exist.
-- These tables were never used by application code (zero references) and
-- their concept is superseded by system_settings (org-scoped JSONB key/value store).
-- Migration is idempotent: IF EXISTS so it never fails on a fresh schema.

DROP TABLE IF EXISTS public.custom_billing_settings;
DROP TABLE IF EXISTS public.custom_note_settings;
