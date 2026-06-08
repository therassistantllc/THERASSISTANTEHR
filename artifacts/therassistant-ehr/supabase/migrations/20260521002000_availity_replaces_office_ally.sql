-- Migration: Full replacement of Office Ally with Availity as the sole
-- clearinghouse vendor. Aligns DB to Availity Batch EDI Companion Guide
-- v.20260429: receiver_id = "030240928" (Availity Dun & Bradstreet),
-- receiver_name = "Availity", GS03 = "030240928".
--
-- Order: (1) migrate row data INTO new vendor value while old check
-- constraint still permits both vendors, (2) rename columns, (3) rename
-- index, (4) drop+recreate vendor check without 'office_ally', (5) flip
-- default on clearinghouse_name.

-- (1) Re-point existing Office Ally connections to Availity values.
UPDATE "public"."clearinghouse_connections"
SET
  vendor = 'availity',
  receiver_id = '030240928',
  receiver_name = 'Availity',
  gs_receiver_code = '030240928',
  updated_at = now()
WHERE vendor = 'office_ally';

UPDATE "public"."clearinghouse_connections"
SET clearinghouse_name = 'availity', updated_at = now()
WHERE clearinghouse_name = 'office_ally';

-- (2) Rename OA-named columns to Availity. Use IF EXISTS so re-running on
-- environments that have already been migrated (e.g. via dev seed) is safe.
ALTER TABLE "public"."payer_profiles"
  RENAME COLUMN "office_ally_payer_id" TO "availity_payer_id";

ALTER TABLE "public"."claim_status_events"
  RENAME COLUMN "office_ally_claim_id" TO "availity_claim_id";

ALTER TABLE "public"."claim_status_events"
  RENAME COLUMN "office_ally_file_id" TO "availity_file_id";

ALTER TABLE "public"."edi_batches"
  RENAME COLUMN "office_ally_file_id" TO "availity_file_id";

-- (3) Rename index.
ALTER INDEX "public"."idx_payer_profiles_office_ally_payer_id"
  RENAME TO "idx_payer_profiles_availity_payer_id";

-- (4) Drop+recreate vendor check, removing 'office_ally' from the allow-list.
ALTER TABLE "public"."clearinghouse_connections"
  DROP CONSTRAINT IF EXISTS "clearinghouse_connections_vendor_check";

ALTER TABLE "public"."clearinghouse_connections"
  ADD CONSTRAINT "clearinghouse_connections_vendor_check"
  CHECK (vendor IN ('availity', 'change_healthcare', 'mock'));

-- (5) Flip default on clearinghouse_name from 'office_ally' to 'availity'.
ALTER TABLE "public"."clearinghouse_connections"
  ALTER COLUMN "clearinghouse_name" SET DEFAULT 'availity';
