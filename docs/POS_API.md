# Fiji Rewards POS gateway: API reference

For POS systems (Fisko POS and others). A POS sends each finished sale to the gateway; the gateway credits the customer's points and answers with text to print on the receipt. The server enforces all the rules (limits, one-time QR codes, fraud checks, monthly settlement). The POS never stores points.

**Base URL:** `https://jwfdbfunrssdwhorxfaq.supabase.co/functions/v1/pos-gateway`
**Auth:** the shop's secret API key: `Authorization: Bearer fjp_...` (or the header `X-Api-Key`). Each key belongs to one shop and can only act for that shop. **Call the gateway from your server only. Never put the key in a browser or mobile app, and never log it.**
**Format:** `POST`, JSON in, JSON out. Answers always contain `"ok": true` or `"ok": false` with `error` (a short code) and `message` (plain English).

## Customer identification
Send **one** of:
- `customer_qr`: the text read by the scanner from the customer's phone, which looks like `fjr:c:<id>:<time>:<signature>`. The code changes every 20 seconds and works **once**. The server checks it against the time of the sale (`occurred_at`): the sale must be finalized within 5 minutes of the moment the customer's phone made the code, so a POS that was offline can still catch up later. A scanner that types into the POS works (it must be a 2D/QR scanner).
- `customer_phone`: a Fiji number typed at the till (`7001234` or `+6797001234`). This is accepted but marked as manual entry and treated with more suspicion by the fraud checks. Use the QR whenever you can.

## POST /lookup
Optional, to show the customer's first name and balance after the scan. It does not use up the QR code.
```json
{ "customer_qr": "fjr:c:3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b:1790000000:be3670a6d83c2f531193" }
```
→ `{ "ok": true, "first_name": "Ana", "balance": 65 }`

## POST /earn
Call once per finished sale, **after** the fiscal receipt exists.
```json
{
  "customer_qr": "fjr:c:...",
  "amount": 45.50,
  "receipt_no": "INV-1001",
  "occurred_at": "2026-10-28T14:05:00+12:00",
  "device_id": "till-2"
}
```
- `amount`: the money the customer actually paid that earns points (see your shop's rule), in FJD with at most 2 decimals. Maximum per sale is FJD 500.
- `receipt_no`: the POS's own unique number for this sale, up to 64 characters (use the VMS invoice number). **This is the "only once" key**: sending the same `receipt_no` again returns the saved result with `"duplicate": true` and never credits twice. So it is always safe to retry.
- `occurred_at` (strongly recommended): when the sale was finalized, with timezone. Always send it, and keep the original value on retries. Sales up to 7 days old are accepted, which lets an offline POS catch up.
- `device_id` (optional): which till.

→ `{ "ok": true, "duplicate": false, "points_earned": 45, "balance": 65, "first_name": "Ana", "receipt_text": "Fiji Rewards: +45 points. Balance: 65 points." }`
Print `receipt_text` on the receipt, after the fiscal part.

## POST /redeem
The customer shows a 6-digit reward code (or QR) in the app. Call before taking payment, then give the discount.
```json
{ "code": "123456", "receipt_no": "INV-1002" }
```
→ `{ "ok": true, "duplicate": false, "reward": "Free tea", "discount_fjd": 0.5, "points_spent": 50, "balance": 15 }`
Apply `discount_fjd` as a discount or loyalty-reward payment on the bill. The code works once and expires 10 minutes after the customer made it. Resending the same `code` and `receipt_no` returns the saved result.

## POST /refund
Call when a sale that earned points is returned, voided or credited.
```json
{ "receipt_no": "INV-1001", "refund_no": "CN-77", "amount": 30, "reason": "returned goods" }
```
- `receipt_no`: the original sale. `refund_no`: the POS's own credit-note or void number (the "only once" key for the refund).
- `amount` (optional): the refunded amount, for a partial refund. Leave it out to reverse the whole sale.
→ `{ "ok": true, "already_done": false, "points_reversed": 30, "balance": 90 }`
If the customer has already spent the points, the balance can go below zero until they earn more.

## Errors
| HTTP | `error` | Meaning and what the POS should do |
|---|---|---|
| 401 | `invalid_api_key` | Wrong, missing or revoked key. Check the setting. |
| 403 | `shop_inactive` | The shop is suspended on Fiji Rewards. Sell normally without points. |
| 422 | `qr_expired`, `qr_invalid` | Ask the customer to open the app and show the QR again, then rescan. |
| 409 | `qr_already_used` | The QR was already used for another sale. Ask for a fresh one. |
| 409 | `receipt_already_claimed` | That `receipt_no` already earned points for someone else. |
| 404 | `customer_not_found` | Not a Fiji Rewards customer. |
| 422 | `sale_exceeds_max`, `sale_too_small`, `invalid_amount` | Fix the amount. Send at most 500, at least enough for 1 point. |
| 422 | `occurred_in_future`, `occurred_too_old` | Check the POS clock; sales older than 7 days cannot be recorded. |
| 429 | `scan_limit_reached`, `till_rate_limit`, `daily_limit_customer` | A limit was reached. Complete the sale without points and tell the cashier. |
| 404 | `code_not_found_or_used` / 422 `code_expired`, `insufficient_points` | Reward code problems. Ask the customer for a new code. |
| 404 / 409 | `receipt_not_found`, `already_fully_refunded` | For refunds: the sale was not found, or was already refunded in full. |
| 5xx or no answer | `server_error` / timeout | Keep the sale. Retry later with the **same** `receipt_no`. |

**The golden rule: a loyalty problem must never stop a sale.** Finish the sale, and retry the loyalty call in the background.

## Setting it up (for the network admin)
1. Deploy once: `supabase functions deploy pos-gateway --no-verify-jwt`.
2. Make a key for a shop, in the Supabase SQL editor: `select create_pos_key('<shop id>', 'Fisko till 1');` (the shop id is in the `merchants` table). **The key is shown only once. Copy it straight away.** Only a fingerprint (hash) is kept, so a lost key cannot be recovered; make a new one. To stop a key: `select revoke_pos_key('<key id>');` (the key ids are in `merchant_api_keys`).
3. Give the key to the shop's POS as a **server-side secret**.
4. Try it: `curl -X POST <base>/lookup -H "Authorization: Bearer fjp_..." -H "Content-Type: application/json" -d '{"customer_phone":"+6797001234"}'`
