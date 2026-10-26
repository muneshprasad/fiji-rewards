-- Build step 2: create the customer profile when someone first signs in by phone.
-- Supabase stores auth.users.phone without the leading "+", so we add it.
-- Existing staff rows are linked to the login by matching phone number.

create function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e164 text;
  bonus integer;
  created_id uuid;
begin
  if new.phone is null or new.phone = '' then
    return new;
  end if;
  e164 := '+' || ltrim(new.phone, '+');

  update staff set user_id = new.id where phone = e164 and user_id is null;

  insert into customers (id, phone) values (new.id, e164)
    on conflict do nothing
    returning id into created_id;

  if created_id is not null then
    select value::integer into bonus from network_settings where key = 'welcome_bonus_points';
    if coalesce(bonus, 0) > 0 then
      insert into transactions (customer_id, type, points_change, expires_at, note, client_txn_id)
      values (created_id, 'adjust', bonus,
              now() + make_interval(months => (select value::integer from network_settings where key = 'points_expiry_months')),
              'welcome bonus', created_id);  -- one per customer: client_txn_id is unique
    end if;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();
