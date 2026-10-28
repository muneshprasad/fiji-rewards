# Paste this into the Claude Code session that works on the Fisko POS codebase

(Everything below the line is the instruction. It is self-contained.)

---

You are working on **Fisko POS**, a VMS (VAT Monitoring System) enabled point-of-sale used in Fiji shops and restaurants. I want you to add an integration with **Fiji Rewards**, a shared loyalty-points program: customers earn points at any member shop by showing a QR code in their phone app, and spend points on rewards at member shops.

## How to work
1. **Do not change anything yet.** First read the codebase and send me a short report: the architecture and language, where an order is finalized, where the fiscal (VMS) receipt and invoice number are produced, where receipts are printed, where refunds/voids/credit notes are handled, where settings live, how barcode scanners are handled today, how background jobs or local storage work, and how tests are run.
2. Then propose a plan that fits the existing structure and conventions, and wait for my OK.
3. Then implement it in small steps with tests, matching the code style around it. Run the existing tests after every step. Do not refactor unrelated code.
4. **Never alter the fiscal (VMS) part of any receipt, invoice or report, or the order in which the fiscal receipt is produced.** Loyalty text is added only after the fiscal section on a printed receipt. If the integration would touch anything fiscal, stop and ask me.

## The golden rule
**A loyalty problem must never stop or slow a sale.** If Fiji Rewards is slow, down, misconfigured or rejects something, the sale completes normally, the cashier sees a short note, and the loyalty call is retried in the background. Use a timeout of about 5 seconds on any call the cashier is waiting for.

## The Fiji Rewards API
Base URL: `https://jwfdbfunrssdwhorxfaq.supabase.co/functions/v1/pos-gateway`
Auth: the shop's secret API key as `Authorization: Bearer fjp_...`. Each key belongs to one shop. **Call the API only from the POS server/back end (or the trusted local service), never from a browser or a customer-facing screen. Store the key as a secret in the existing secret/config mechanism (per shop or per till), never in source code, never in logs.** HTTPS only. Every request is `POST` with a JSON body; every answer has `"ok": true` or `"ok": false` plus `error` (a code) and `message` (plain English).

### Identifying the customer
Send either `customer_qr` or `customer_phone`:
- `customer_qr`: the exact text the scanner reads from the customer's phone, which looks like `fjr:c:<uuid>:<time>:<signature>`. It changes every 20 seconds and works only once. The server checks it against the **time of the sale** (`occurred_at`): the sale must be finalized within 5 minutes of the moment the customer's phone made the code. **Do not modify it, shorten it, or log it.**
- `customer_phone`: a Fiji mobile number typed by the cashier (`7001234` or `+6797001234`). Accepted, but treated as less trustworthy. Offer it only as a fallback.

### POST /lookup (optional, to show the name and balance after scanning)
Body: `{ "customer_qr": "..." }` → `{ "ok": true, "first_name": "Ana", "balance": 65 }`. It does not use up the QR.

### POST /earn (call once per finished sale)
Body: `{ "customer_qr": "...", "amount": 45.50, "receipt_no": "INV-1001", "occurred_at": "2026-10-28T14:05:00+12:00", "device_id": "till-2" }`
- `amount`: the eligible amount (see "Eligible amount" below), FJD, at most 2 decimals, **at most 500 per sale** (send 500 if the eligible amount is higher).
- `receipt_no`: the VMS **invoice number** of the sale, unique per shop, up to 64 characters. It is the "only once" key: sending the same `receipt_no` again returns the saved result with `"duplicate": true` and never credits twice. **It is therefore always safe to retry.**
- `occurred_at`: ISO time with timezone of when the sale was finalized. Sales up to 7 days old are accepted, so an offline POS can catch up later.
- Answer: `{ "ok": true, "duplicate": false, "points_earned": 45, "balance": 65, "first_name": "Ana", "receipt_text": "Fiji Rewards: +45 points. Balance: 65 points." }`. Print `receipt_text` in the receipt footer after the fiscal part.

### POST /redeem (customer pays with a reward)
Body: `{ "code": "123456", "receipt_no": "INV-1002" }` where `code` is the 6-digit reward code the customer shows in their app (they may show a QR containing `fjr:r:123456`; the digits after the last colon are the code).
Answer: `{ "ok": true, "duplicate": false, "reward": "Free tea", "discount_fjd": 0.5, "points_spent": 50, "balance": 15 }`. Apply `discount_fjd` to the bill as a discount line or loyalty-reward tender (ask me how the shop's accountant wants VAT shown). The code works once. Redeem **before** taking payment, because it changes the total.

### POST /refund (a sale that earned points is returned, voided or credited)
Body: `{ "receipt_no": "INV-1001", "refund_no": "CN-77", "amount": 30, "reason": "returned goods" }`. `receipt_no` is the original sale; `refund_no` is this POS's credit-note or void number (the "only once" key for the refund); `amount` is optional (omit it to reverse the whole sale). Answer: `{ "ok": true, "already_done": false, "points_reversed": 30, "balance": 90 }`.

### Errors (HTTP status, `error`) and what the POS should do
| Status | error | Do this |
|---|---|---|
| 401 | invalid_api_key | Show "Loyalty is misconfigured" to the manager, never to the customer. Sell normally. |
| 403 | shop_inactive | Sell normally without points. |
| 422 | qr_expired, qr_invalid | Tell the cashier: "Ask the customer to show the QR again", and let them rescan. |
| 409 | qr_already_used | "Ask for a fresh QR code." |
| 404 | customer_not_found | "Not a Fiji Rewards customer." |
| 409 | receipt_already_claimed | Already credited to someone else. Do not retry. |
| 422 | sale_exceeds_max, sale_too_small, invalid_amount | Fix the amount (cap at 500; too small to earn is fine, just skip). |
| 422 | occurred_in_future, occurred_too_old | Log it for the manager. |
| 429 | scan_limit_reached, till_rate_limit, daily_limit_customer | Sale completes without points. Tell the cashier "Points limit reached". |
| 404, 422 | code_not_found_or_used, code_expired, insufficient_points | Reward code problem: "Ask the customer for a new code." |
| 404, 409 | receipt_not_found, already_fully_refunded | For refunds: log and show a short note. |
| 5xx, timeout, no network | server_error | Keep the sale. Put the call in the outbox and retry later with the same receipt_no. |

## What to build

### 1. Settings (per shop, behind a feature flag)
`loyalty_enabled` (default **off**), `loyalty_base_url`, `loyalty_api_key` (secret), `loyalty_eligible_amount_rule`, `loyalty_cap_per_sale` (default 500), `loyalty_timeout_ms` (default 5000). With the flag off, behavior must be identical to today.

### 2. Eligible amount (what earns points)
Default rule: the money actually paid for the order, **including VAT**, **excluding** tips, gift-card purchases, deposits, and any part paid with a loyalty reward or gift card, rounded to 2 decimals and capped at `loyalty_cap_per_sale`. Make this a small function with tests so the shop can change the rule later. If the amount is 0 or too small to earn a point, skip the call.

### 3. Scanning the customer at checkout
- Add a **Loyalty** step/button on the payment screen (and a shortcut if scanning is already a common action). When active, capture input from the scanner: a 2D (QR) scanner that behaves like a keyboard sends the whole code as fast keystrokes ending in Enter. Detect that burst (do not rely on a visible text box having focus) and accept text that starts with `fjr:c:` as a customer code, `fjr:r:` or six digits as a reward code. Ignore other scanner input there so normal product barcodes keep working.
- On a customer scan, call `/lookup` (server-side), show the first name and balance on the cashier screen, and store `customer_qr` on the open order. Provide a "Remove customer" button and a fallback to enter a phone number.
- Remember the sale must be finalized within 5 minutes of the QR being made, and the QR works once. If the order takes longer than that to finish, ask the cashier to rescan before payment completes. Always send `occurred_at` (the real finalization time) on `/earn`.
- Never display, print or log the full QR text. Mask it.

### 4. Earning points when the sale is finalized
After the sale is paid and the fiscal receipt/invoice number exists, call `/earn` with `receipt_no` = the VMS invoice number. On `ok`, add `receipt_text` to the receipt footer (after the fiscal part) and show the cashier "+45 points". On failure, apply the error table above. Never print something that claims points were earned unless the call returned ok.

### 5. Reliable delivery (the outbox)
Add a small persistent outbox (use the storage the POS already uses) for loyalty calls that could not be completed because of timeouts or server/network errors. Each entry stores: type (earn or refund), the exact request body, when it was created, the number of attempts. Retry in the background with exponential backoff (for example 1, 2, 5, 15, 60 minutes), using the **same** `receipt_no`/`refund_no` every time, so duplicates are impossible. Drop an entry when the API answers `ok`, or with a non-retryable error (4xx other than 429), and keep a visible record of dropped ones for the manager. Because the server checks the QR against the sale time (`occurred_at`), a late retry still works as long as the sale was finalized within 5 minutes of the QR being made and `occurred_at` is the original finalization time (not the retry time). If the API still answers `qr_expired`, the sale itself was too long after the scan: do not retry; record "points not credited" so the shop can fix it manually. Sales older than 7 days cannot be recorded. Show the manager how many entries are waiting.

### 6. Redeeming a reward
When the cashier enters or scans a reward code, call `/redeem` (before payment), then add the discount line. If the order is later cancelled after a redeem succeeded, show a clear warning that the customer's points were already spent and must be returned manually (there is no un-redeem call yet). Ask for confirmation before redeeming.

### 7. Refunds, voids and credit notes
When a finalized order that earned points is refunded, voided or credited, call `/refund` with `receipt_no` = the original invoice number, `refund_no` = the credit-note/void number, and `amount` = the refunded amount (omit for a full refund). Same outbox rules. Store on the order whether it earned loyalty points, so you know when to call it.

### 8. Restaurants
Split bills: each payment is its own sale with its own invoice number and its own scan. Tips are never eligible. Table orders that are re-opened or re-finalized must keep the same `receipt_no` for the same invoice, never create a new one for the same fiscal invoice.

### 9. Permissions and audit
Only managers can change loyalty settings and see the outbox. Write an audit-log entry for each loyalty call result (type, receipt number, ok or error code), never including the API key or the customer QR.

### 10. Tests (required)
Write tests that mock the Fiji Rewards API for every answer in the error table, plus:
- flag off: nothing changes;
- sale completes even when the API times out, returns 5xx, or the network is down;
- the outbox retries with the same `receipt_no` and stops after `ok`;
- a duplicate answer is treated as success;
- the eligible-amount function (tips, gift cards, reward discount, cap at 500, tiny amounts);
- scanner burst detection (a QR vs a product barcode vs normal typing);
- refund of a full and a partial amount;
- the API key and QR never appear in logs or error messages;
- fiscal receipt output is byte-for-byte unchanged apart from the added loyalty footer.

## Deliverables
1. The report and the plan (before coding).
2. The implementation with tests passing.
3. A short `LOYALTY.md` for the shop owner: how to switch it on, where the key goes, what the cashier sees, what the outbox is, and how to switch it off.
4. A list of anything that needs my decision (for example how VAT is shown on a loyalty discount, or changes that might need VMS re-approval).

Start with step 1, the report. Do not write code yet.
