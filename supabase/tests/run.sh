cd "$(dirname "$0")/../.."
D=/var/tmp/pgfiji; B=/usr/lib/postgresql/16/bin
su postgres -s /bin/bash -c "$B/pg_ctl -D $D/data -o '-p 5544 -k $D' -l $D/log -w start" >/dev/null
P="psql -h $D -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists t" -c "create database t"; P="$P -d t"
for f in supabase/tests/stub_supabase.sql supabase/migrations/*.sql supabase/seed.sql supabase/tests/schema_test.sql supabase/tests/auth_test.sql supabase/tests/engine_test.sql supabase/tests/dashboard_test.sql supabase/tests/fraud_test.sql supabase/tests/sms_test.sql supabase/tests/settlement_test.sql supabase/tests/receipt_test.sql supabase/tests/pos_test.sql; do $P -f $f 2>&1 | grep -v '^$'; done
# pilot setup: placeholders must be refused, then a filled-in copy must run twice without duplicating anything
$P -f supabase/pilot/pilot_setup.sql >/dev/null 2>/var/tmp/pilot_err.txt && echo "FAIL: placeholders were accepted" || grep -q "Replace the placeholder" /var/tmp/pilot_err.txt && echo "pilot placeholders refused: ok"
sed 's/XXXXXX/700000/g' supabase/pilot/pilot_setup.sql > /var/tmp/pilot_filled.sql
$P -f /var/tmp/pilot_filled.sql >/dev/null && $P -f /var/tmp/pilot_filled.sql >/dev/null && $P -f supabase/tests/pilot_check.sql 2>&1 | grep -v '^$'
$P -f supabase/pilot/pilot_metrics.sql >/dev/null && echo "pilot metrics queries run: ok"
# day-0 check: run against the customer and cashier created by the earlier tests
sed "s/+6797001234/+6797400001/; s/+6797001235/+6797500001/; s/+6797001236/+6797600001/" supabase/pilot/day0_verify.sql > /var/tmp/day0.sql
$P -f /var/tmp/day0.sql | head -20
su postgres -s /bin/bash -c "$B/pg_ctl -D $D/data stop -m fast" >/dev/null
