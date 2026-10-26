# Fiji Rewards: project brief for Claude Code

A shared loyalty wallet for Fiji. Customers earn points at any participating shop with one QR code and redeem them at any member shop. Goal: wide, weekly use. Revenue is not a goal in year one. Pilot: Nadi, 20 to 30 merchants.

## Source material (read these first)
- Product spec (doc): https://claude.ai/artifact/PqH7GdXsQS8GE9W6A3vM5v
- Screen designs (7 phone screens, customer and merchant): https://claude.ai/artifact/FMqNBmrqC8xsbY5qSQsfss
- Merchant pitch (doc): https://claude.ai/artifact/DrYx292AgTCWG99RJi3QuD

Shop names, points and sales figures in the designs are sample content.

## Users
- Customer: signs in with phone number and SMS OTP, shows QR code, sees points, browses deals, redeems.
- Cashier: scans customer QR (or types the number), enters bill amount, confirms; scans or types a redemption code.
- Merchant owner: sets points rate and rewards, sees daily numbers.

## V1 scope (build only this)
1. Phone and OTP login (no email, no password)
2. Customer QR code, points balance, history
3. Deals list (by category and distance), merchant detail
4. Redeem: 6-digit code plus QR, single use, expires in 10 minutes
5. Merchant app: scan or number entry, enter amount, confirm sale, redeem code
6. Merchant rewards setup and a basic Today dashboard
7. SMS receipt per transaction
8. Offline queue at the till (sales saved locally, synced when online)

Not in V1: referrals, stamps, tiers, push, M-PAiSA or MyCash links, Fijian and Hindi language, staff roles.

## Data model
- Customer: id, phone, name, language, created_at, referral_code, status
- Merchant: id, business_name, category, town, address, owner_phone, points_per_fjd, status
- Staff: id, merchant_id, name, phone, role (cashier | manager)
- Reward: id, merchant_id, title, points_cost, value_fjd, active_from, active_to, daily_limit
- Transaction: id, customer_id, merchant_id, staff_id, type (earn | redeem | expire | adjust), amount_fjd, points_change, timestamp, device_id, sync_status

Rule: balance = sum of a customer's transactions. Never edit a balance directly; only append transactions. Keep an audit log.

## Rules (starting values, keep them configurable)
- Earn rate: 1 point per FJD 1, per-merchant adjustable within network limits
- Welcome bonus 20 points; referral bonus 50 points (V2)
- Points expire 12 months after earning
- Max sale per scan FJD 500; limit scans per customer per hour per merchant
- Redemption code: one use, 10-minute expiry
- Offline: merchant device queues earn transactions and syncs later; redemptions need a connection or a pre-synced code so points cannot be spent twice

## Suggested stack (default proposal, confirm before building)
- Mobile: Expo (React Native), Android first, APK under 25 MB, low-end phone friendly
- Backend: Supabase (Postgres, auth, row-level security) hosted in the Sydney region, or equivalent
- SMS OTP: a provider that delivers to Fiji numbers (to be chosen)
- Merchant web page for owners who prefer a computer (after the mobile app)
- Text-first screens, compressed images, no autoplay video (mobile data is expensive)

## Design tokens (from the canvas)
Font Plus Jakarta Sans. Ink #0D2B2E, teal #0B6B6A, deep teal #08403F, background #F4F9F8, border #D5E4E2, muted text #4A6568, gold (points) #F5B83D, warning #FFF1D0, danger text #B3263D. Touch targets at least 44 px. Text contrast at least 4.5:1.

## Suggested build order
1. Project setup, database schema, row-level security, seed data (6 sample merchants)
2. OTP login and customer profile
3. Transactions engine: earn, redeem, expire, balance (with tests)
4. Merchant app: scan, enter sale, confirm
5. Customer app: home, QR, history, deals, redeem
6. Offline queue and sync, with tests for dropped connections
7. Merchant dashboard and rewards setup
8. Fraud limits and alerts
9. Pilot build with 3 test merchants in Nadi

## Open questions for the owner
- Final brand name (Fiji Rewards or something more local)
- Whether the group companies are the first merchants
- Whether the network funds any rewards or only merchants
- Legal and tax rules for loyalty points and customer data in Fiji
- SMS provider and mobile-money partner
