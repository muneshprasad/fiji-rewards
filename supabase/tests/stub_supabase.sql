-- Minimal stand-ins for the Supabase pieces the schema needs, for plain-Postgres test runs.
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), phone text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
