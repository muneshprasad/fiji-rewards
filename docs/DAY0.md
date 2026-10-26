# Day-0 test: step by step

You need two Android phones (one customer, one cashier), the APK, and the Supabase SQL editor open.
Test with **your own numbers**, not real customers. Do the steps in order.

After each step, paste `supabase/pilot/day0_verify.sql` into the SQL editor (change the three phone numbers on the first line once) and run it. The row for that step should say **PASS**. If it says NOT YET, find the symptom below.

| Step | Do this | You should see | Verify row |
|---|---|---|---|
| 0 | Before anyone signs in: run `pilot_setup.sql` with your test numbers as owner and cashier | The 3 shops listed at the bottom of the result | 3, 4 show "no staff record" until you do this |
| 1 | **Customer phone:** open the app, enter the number, enter the SMS code | The home screen: 20 points and a QR code | 1, 2 |
| 2 | **Cashier phone:** sign in | The till (Scan customer QR, Type customer number, Redeem a code), not the customer screens | 3 |
| 3 | **Owner phone:** sign in | The till plus **Today's numbers** and **Rewards and points rate** | 4 |
| 4 | Cashier taps **Scan customer QR**, scans the customer phone, types 30, confirms | "Sale recorded". Customer pull-to-refresh shows 50 points (at a 1.0 rate shop) | 5, 6 |
| 5 | Take a screenshot of the customer QR. Wait 6 minutes. Cashier scans the screenshot | It is refused ("out of date") | none: refusals are not stored |
| 6 | Wait about a minute | A receipt SMS arrives on the customer phone | 7, 8 |
| 7 | Customer: **Deals**, open the shop, tap **Redeem** on a reward they can afford | A 6-digit code, a QR and a 10-minute countdown | none yet |
| 8 | Cashier: **Redeem a code**, scan or type it | "Reward redeemed" and the new balance. Trying the same code again says it is not found or already used | 9 |
| 9 | Cashier phone: turn on airplane mode. Scan the customer QR, type 20, confirm | "Saved on this phone". Home screen says 1 sale waiting to send | none yet |
| 10 | Turn airplane mode off. Wait up to 30 seconds | The waiting banner disappears. Customer balance goes up by 20 (once) | 10 |
| 11 | Owner: open **Today's numbers**. Open **Rewards and points rate**, change a reward's name, save | Today shows the sales and redemption; the reward changes in the customer's Deals list | none |
| 12 | Make yourself a network admin (SQL at the bottom of `supabase/schedule.sql`), sign out and in | An **Alerts** tab appears for you | 12 |

Finally, check row 11 ("Balance equals the sum of the history") and read the customer history list on the phone. Every sale should appear once.

## When something does not work

| What you see | Most likely cause | What to do |
|---|---|---|
| No SMS code arrives | Twilio is not allowed to send to Fiji, or the sender cannot reach Fiji networks, or the Twilio account is still a trial | Twilio Console > Monitor > Logs shows the error. Enable Fiji in Messaging geo-permissions. On a trial account, verify the number in Twilio first. Also check Supabase > Authentication > Logs |
| "We could not send the code" in the app | The Phone provider is off in Supabase, or the Twilio keys are wrong, or you asked for a code less than 60 seconds ago | Supabase > Authentication > Providers > Phone. Wait a minute and try again |
| Code is rejected | Mistyped, or it expired, or a newer code replaced it | Request a new code and use only the latest SMS |
| Sign-in works but the app says to set environment values | The APK was built without the Supabase URL and anon key | Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in EAS and rebuild |
| Cashier or owner sees customer screens, not the till | The staff phone number does not match the number they signed in with, or the staff record is switched off, or the shop is not `active` | Verify row 3 says why. Phone numbers must be exactly `+679` and 7 digits. Fix the number in the `staff` table; they are linked automatically |
| Till says "This account is not set up as a cashier" | The shop was suspended (or its status is not active) | In the `merchants` table set `status` to `active` |
| Camera does not open | Camera permission was refused | Android Settings > Apps > Fiji Rewards > Permissions > Camera |
| Scan does nothing | QR is too small, the screen is dim, or it is a different kind of QR | Turn the customer's brightness up and hold steady; the code must be the one on the Home tab |
| "This QR code is out of date" right away | The customer or cashier phone has a wrong clock and has never been online to correct it, or too long passed between scan and Confirm (limit is 5 minutes) | Connect both phones to the internet once, open the app, and try again |
| "Connect to the internet once to set up your code" on the customer phone | The code's secret has not been fetched yet | Connect once and reopen the app. After that the QR works with no signal |
| "This QR code was already used" | The same code was scanned twice | Wait for the next code (changes every 20 seconds) |
| "No customer found" | The number is not registered, or the customer is suspended | The customer must sign in once first |
| Sale refused: "too many scans" | 3 scans per customer per hour per shop | Wait, or change `max_scans_per_hour` in `network_settings` for testing |
| Receipt row 7 says NOT YET | The customer switched receipts off, or the sale was for FJD under 1 point | Account tab > "Text me a receipt" |
| Receipt row 8 says `pending` for many minutes | The `send-receipts` job is not scheduled, or the function is not deployed | Run the receipts part of `supabase/schedule.sql`; check Edge Functions > send-receipts > Logs |
| Receipt row 8 says `failed` | Twilio refused the message; the reason is saved in the row | `select last_error from sms_outbox where status = 'failed'` |
| Offline sale stays "waiting" | Still no signal, or the server refused it | Open "View sales waiting". A refused sale shows the reason (for example the QR was older than 5 minutes when the sale was made, or the sale is older than 7 days) |
| Reward button is greyed out | Not enough points | The button says how many more points are needed |
| "This reward is fully claimed for today" | The reward's daily limit is used up | Raise the limit under Rewards and points rate |

## Send me the results
If something fails, send me: the step number, what the screen said (a photo is fine), and the output of the verify query. For SMS problems, add the Twilio log line. I can usually tell the cause from that.
