-- A staff record is linked to a login by phone number. Until now that only happened when the person
-- first signed in. If they signed in BEFORE their staff record was created (for example while testing,
-- or when a new cashier is added later), they were never linked and saw the customer screens.
-- Now the link is also made when the staff record is created or its phone changes.

create function link_staff_to_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    select id into new.user_id from auth.users where phone = ltrim(new.phone, '+') limit 1;
  end if;
  return new;
end $$;

create trigger staff_link_login before insert or update of phone on staff
  for each row execute function link_staff_to_login();

-- link anyone who is already waiting
update staff s set user_id = u.id from auth.users u
 where s.user_id is null and u.phone = ltrim(s.phone, '+') and not exists (select 1 from staff x where x.user_id = u.id);

revoke all on function link_staff_to_login() from public, anon, authenticated;
