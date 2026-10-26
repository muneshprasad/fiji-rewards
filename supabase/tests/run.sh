cd "$(dirname "$0")/../.."
D=/var/tmp/pgfiji; B=/usr/lib/postgresql/16/bin
su postgres -s /bin/bash -c "$B/pg_ctl -D $D/data -o '-p 5544 -k $D' -l $D/log -w start" >/dev/null
P="psql -h $D -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists t" -c "create database t"; P="$P -d t"
for f in supabase/tests/stub_supabase.sql supabase/migrations/*.sql supabase/seed.sql supabase/tests/schema_test.sql supabase/tests/auth_test.sql supabase/tests/engine_test.sql supabase/tests/dashboard_test.sql; do $P -f $f 2>&1 | grep -v '^$'; done
su postgres -s /bin/bash -c "$B/pg_ctl -D $D/data stop -m fast" >/dev/null
