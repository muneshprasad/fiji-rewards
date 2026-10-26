# Nadi pilot: setup and launch guide

Goal: 3 shops, real customers, one month. Learn whether people use it weekly. Revenue is not a goal.

Everything below needs accounts only you can create. Nothing here has been run against a real Supabase project or a real phone yet, so treat the first full run as part of the pilot test.

## 1. Accounts
- **Supabase** project in the **Sydney** region.
- **Twilio** account with a Messaging Service (see section 3).
- **Expo (EAS)** account to build the Android APK.

## 2. Supabase
1. Install the Supabase CLI, then in this folder: `supabase link --project-ref <ref>` and `supabase db push`. This applies all migrations in `supabase/migrations/` in order.
2. **Do not** load `supabase/seed.sql` on the live project. It is demo data for local testing.
3. Auth: Dashboard > Authentication > Providers > Phone: turn on, choose Twilio, enter the Account SID, Messaging Service SID and Auth Token. Remove the test OTP number from `config.toml` before using `supabase config push`.
4. SMS receipts function: `supabase functions deploy send-receipts`, then set its secrets:
   `supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_MESSAGING_SERVICE_SID=...`
5. Scheduled jobs: enable the `pg_cron`, `pg_net` and Vault extensions, store the service role key in Vault, then run `supabase/schedule.sql` (point expiry, fraud checks, receipt sending).
6. Make yourself a network admin so you see the **Alerts** tab: the one-line SQL is at the bottom of `supabase/schedule.sql`. Sign in to the app with your phone first.

## 3. Twilio and Fiji
- Create a **Messaging Service** and add a sender that can reach Fiji numbers (+679).
- In Twilio, enable **Fiji** under Messaging geo-permissions.
- Check with Twilio whether Fiji networks accept your sender type (a regular number or an alphanumeric sender ID). I could not verify this. Send a test SMS to a Digicel and a Vodafone number before anything else.
- Cost: each customer costs 1 SMS to sign in, plus 1 receipt per sale or reward. Get Twilio's Fiji price and multiply by your expected volume. Receipts can be turned off by customers in the app, and you can stop them by not running the `send-receipts` job.

## 4. Load the 3 pilot shops
1. Open `supabase/pilot/pilot_setup.sql`. Replace the sample shop names, addresses, owner and cashier phone numbers, and rewards with the real ones. Phones look like `+6797001234`. The script refuses to run until the placeholders are replaced.
2. Run it in the SQL editor. You can run it again after edits; it updates instead of duplicating.
3. Owners and cashiers just sign in with their phone number. The app opens the till for them automatically. Owners (managers) also get **Today's numbers** and **Rewards and points rate**.

## 5. Build the APK
1. In `app/`: `npm install`, then set the two environment values for the build (the Supabase URL and anon key) in your EAS project: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
2. `npx eas build --platform android --profile pilot` produces an APK you can share by link.
3. **Check the file size.** The brief asks for under 25 MB. I could not build here, so the size is unmeasured. The build is set to ship 64-bit and 32-bit ARM only, with code and resource shrinking on. If it is too big, remove `armeabi-v7a` in `app/app.json`; very old phones then cannot install it.
4. Test on a cheap Android phone, not only a new one.

## 6. Day-0 test (do all of it before inviting anyone)
The full step-by-step, with a verification query and a troubleshooting table, is in [`docs/DAY0.md`](DAY0.md). In short:
Use 2 phones: one as a customer, one as a cashier.
1. Customer signs in with SMS code. Gets 20 welcome points. Name can be set in Account.
2. Cashier signs in. The till opens (not the customer screens).
3. Cashier scans the customer QR, enters FJD 30, confirms. Customer sees 50 points (20 + 30 at rate 1). A receipt SMS arrives.
4. Scan the same QR screenshot a minute later: it is refused (out of date or already used).
5. Customer opens a shop, taps Redeem on a reward they can afford. A 6-digit code and QR appear with a 10-minute timer. Cashier redeems it. Balance drops. Receipt arrives. Trying the code again fails.
6. Put the cashier phone in airplane mode. Scan, enter a sale, confirm. It says "Saved on this phone". Turn the signal back on: it sends by itself within 30 seconds, and the customer's balance goes up once.
7. Owner signs in: Today shows the sales. Change a reward and the points rate.
8. As network admin, confirm the Alerts tab opens.

## 7. Training the cashiers (one minute each)
- Ask the customer to open the app and show the QR code. Scan it. Type the bill. Confirm.
- No QR? Type their phone number instead (needs signal).
- To redeem: tap **Redeem a code**, scan or type the 6 digits.
- No signal is fine for sales. Check **sales waiting to send** at the end of the day; it should say nothing is waiting.

## 8. Measuring the pilot
Run `supabase/pilot/pilot_metrics.sql` each week. Look at: customers active in the last 7 days, sales per shop, how many customers came back on more than one day, points redeemed as a share of points earned, SMS delivery, and open alerts.

## 9. Things the pilot will not have
Android only. English only. No staff management screen (add staff in the database or by editing `pilot_setup.sql`). No owner web page. No push notifications. Redemptions need a connection. No referrals, stamps or tiers.

## 10. Decide before going public (not technical)
- Legal and tax treatment of loyalty points in Fiji, and who owns the liability for unredeemed points.
- A privacy notice and terms for customers (we store phone number, optional name, and purchase history). Add the link to the sign-in screen.
- Who funds rewards: shops only, or the network too.
- Final brand name (the logo and app say "Fiji Rewards").
- Mobile-money partner (M-PAiSA, MyCash) for later.
