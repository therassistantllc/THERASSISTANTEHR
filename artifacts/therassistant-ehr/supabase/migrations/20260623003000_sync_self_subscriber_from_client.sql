create or replace function public.sync_self_subscriber_from_client_for_policy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subscriber_id is not null
     and new.client_id is not null
     and coalesce(lower(new.subscriber_relationship::text), 'self') = 'self' then
    update public.insurance_subscribers s
    set
      first_name = coalesce(nullif(c.first_name, ''), s.first_name),
      last_name = coalesce(nullif(c.last_name, ''), s.last_name),
      date_of_birth = coalesce(c.date_of_birth, s.date_of_birth),
      relationship_to_client = 'self',
      phone = coalesce(nullif(c.phone, ''), s.phone),
      address_line_1 = coalesce(nullif(c.address_line_1, ''), s.address_line_1),
      address_line_2 = coalesce(nullif(c.address_line_2, ''), s.address_line_2),
      city = coalesce(nullif(c.city, ''), s.city),
      state = coalesce(nullif(c.state, ''), s.state),
      postal_code = coalesce(nullif(c.postal_code, ''), s.postal_code),
      updated_at = now()
    from public.clients c
    where c.id = new.client_id
      and c.organization_id = new.organization_id
      and s.id = new.subscriber_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_self_subscriber_from_client_for_policy on public.insurance_policies;
create trigger trg_sync_self_subscriber_from_client_for_policy
after insert or update of client_id, subscriber_id, subscriber_relationship
on public.insurance_policies
for each row
execute function public.sync_self_subscriber_from_client_for_policy();

create or replace function public.sync_self_subscriber_from_client_after_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.insurance_subscribers s
  set
    first_name = coalesce(nullif(new.first_name, ''), s.first_name),
    last_name = coalesce(nullif(new.last_name, ''), s.last_name),
    date_of_birth = coalesce(new.date_of_birth, s.date_of_birth),
    relationship_to_client = 'self',
    phone = coalesce(nullif(new.phone, ''), s.phone),
    address_line_1 = coalesce(nullif(new.address_line_1, ''), s.address_line_1),
    address_line_2 = coalesce(nullif(new.address_line_2, ''), s.address_line_2),
    city = coalesce(nullif(new.city, ''), s.city),
    state = coalesce(nullif(new.state, ''), s.state),
    postal_code = coalesce(nullif(new.postal_code, ''), s.postal_code),
    updated_at = now()
  from public.insurance_policies p
  where p.subscriber_id = s.id
    and p.client_id = new.id
    and p.organization_id = new.organization_id
    and coalesce(lower(p.subscriber_relationship::text), 'self') = 'self'
    and p.archived_at is null;

  return new;
end;
$$;

drop trigger if exists trg_sync_self_subscriber_from_client_after_client_update on public.clients;
create trigger trg_sync_self_subscriber_from_client_after_client_update
after update of first_name, last_name, date_of_birth, phone, address_line_1, address_line_2, city, state, postal_code
on public.clients
for each row
execute function public.sync_self_subscriber_from_client_after_client_update();

update public.insurance_policies p
set updated_at = now()
where coalesce(lower(p.subscriber_relationship::text), 'self') = 'self'
  and p.archived_at is null;
