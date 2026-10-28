# Claiming points by scanning a VMS receipt

Status: the **server rules are built and tested** (migration 10, `claim_receipt`). The **scan screen in the app is not built yet**, because I have not seen what is inside a real receipt's QR code.

## What is built
- Each shop has a **tax number** (`merchants.tin`, digits only). Set it in `pilot_setup.sql` (`"tin"`).
- `claim_receipt(tax number, receipt number, amount, receipt time, amount-from-QR)` credits the signed-in customer:
  - the shop must be active and have that tax number on file;
  - **a receipt can be claimed once per shop**, by the first person; the same customer scanning again just sees "already counted";
  - a cashier recording the sale with a receipt number blocks a later claim, and the other way round, so a sale cannot earn twice;
  - the receipt must be no older than **24 hours** (`receipt_claim_hours`) and not in the future;
  - the usual caps apply: FJD 500 per sale, 1,000 points per customer per day, and **5 receipt claims per customer per hour** (`max_receipt_claims_per_hour`);
  - if the amount had to be **typed** (not read from the QR), it is capped at FJD 100 (`receipt_typed_max_fjd`);
  - a shop's own staff cannot claim points on their own shop's receipts.
- Points use the shop's earn rate, the customer gets the usual SMS receipt, and the shop is charged like any other issued points.

## What I still need to build the scan screen
1. A clear photo of a receipt from each pilot shop, QR code visible.
2. The text you get when you scan that QR code with a phone camera.

From those I can write the reader (the "parser") and add a **Scan receipt** button to the customer app. If the QR only holds a link or a receipt number and not the amount, the amount would have to be typed from the printed receipt (the lower FJD 100 cap above), unless FRCS allows us to look the receipt up.

## To switch it on later
1. Run migration `20261026000010_receipt_claims.sql` in the Supabase SQL editor.
2. Put each shop's tax number in `pilot_setup.sql` and run it again.
3. Update the app (a new build).
