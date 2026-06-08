-- Add optional emergency contact fields to clients so front-desk intake can
-- capture the full identity record in a single step (task: capture full
-- client identity when adding a new client).
alter table public.clients
  add column if not exists emergency_contact_name text null,
  add column if not exists emergency_contact_phone text null;

notify pgrst, 'reload schema';
