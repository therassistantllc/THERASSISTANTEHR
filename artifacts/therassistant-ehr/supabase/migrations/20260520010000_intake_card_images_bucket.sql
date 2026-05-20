-- Migration: 20260520010000_intake_card_images_bucket.sql
-- Purpose: Provision a private Supabase Storage bucket for intake insurance
--          card photos. Card images are uploaded by patients via the intake
--          flow and served back to staff through an authenticated proxy
--          route; the bucket itself remains private.

insert into storage.buckets (id, name, public)
values ('intake-card-images', 'intake-card-images', false)
on conflict (id) do update
  set public = excluded.public;

-- No public RLS policies are added. Access goes through the service role
-- inside the Next.js server routes, which enforce organization-level auth
-- via the existing rbac middleware.

select pg_notify('pgrst', 'reload schema');
