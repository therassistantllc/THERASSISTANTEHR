-- Task #557: Send the client update link by text message too.
--
-- Extends cob_client_update_links so SMS is a first-class delivery
-- option alongside clipboard/email:
--   * delivery_method now allows 'sms'
--   * delivered_to_phone records the destination number (E.164 ideally)
-- The delivery_status / delivery_provider_id / delivery_error / delivered_at
-- columns are reused as-is so billers see a single "did it arrive?" view
-- regardless of channel.

do $$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
    where conrelid = 'public.cob_client_update_links'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%delivery_method%'
  loop
    execute format('alter table public.cob_client_update_links drop constraint %I', cname);
  end loop;
end$$;

alter table public.cob_client_update_links
  add constraint cob_client_update_links_delivery_method_check
  check (delivery_method in ('clipboard', 'email', 'sms'));

alter table public.cob_client_update_links
  add column if not exists delivered_to_phone text;

select pg_notify('pgrst', 'reload schema');
