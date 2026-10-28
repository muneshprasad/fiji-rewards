// Database errors carry a short code in the message. Show a plain sentence to the cashier.
const MESSAGES: Record<string, string> = {
  not_staff: 'This account is not set up as a cashier.',
  customer_not_found: 'No customer found. Check the number or scan again.',
  sale_exceeds_max: 'That sale is over the FJD 500 limit.',
  invalid_amount: 'Enter the bill amount.',
  sale_too_small: 'This sale is too small to earn a point.',
  scan_limit_reached: 'This customer has already scanned several times this hour.',
  occurred_in_future: 'The phone clock looks wrong. Check the date and time.',
  occurred_too_old: 'This sale is too old to record.',
  client_txn_id_conflict: 'This sale ID was already used for something else. Start again.',
  code_not_found_or_used: 'Code not found, or already used.',
  code_expired: 'This code has expired. Ask the customer for a new one.',
  qr_invalid: 'This QR code is not valid. Ask the customer to open the app and show it again.',
  qr_required: 'Scan the customer\'s QR code, or type their phone number.',
  qr_expired: 'This QR code is out of date. Ask the customer to show their code again.',
  qr_already_used: 'This QR code was already used. Ask the customer to wait a few seconds for a fresh one.',
  daily_limit_customer: 'This customer has reached the points limit for today.',
  till_rate_limit: 'Too many sales from this login in the last hour. Try again shortly.',
  redeem_limit_reached: 'You can redeem up to 3 rewards a day.',
  receipt_already_claimed: 'Someone has already claimed this receipt.',
  receipt_invalid: 'This receipt could not be read. Ask the cashier to print it again.',
  receipt_too_old: 'This receipt is too old to claim. Receipts can be claimed for 24 hours.',
  unknown_shop: 'This shop is not part of Fiji Rewards yet, or its receipts cannot be claimed.',
  cannot_claim_own_shop: 'Staff cannot claim points on their own shop\'s receipts.',
  claim_limit_reached: 'You have claimed several receipts this hour. Try again later.',
  typed_amount_too_large: 'That amount is too large to claim without scanning the receipt.',
  insufficient_points: 'Not enough points for this.',
  daily_limit_reached: 'This reward is fully claimed for today. Try again tomorrow.',
  reward_not_active: 'This reward is not available right now.',
  reward_not_found: 'This reward is no longer available.',
  merchant_inactive: 'This shop is not taking part right now.',
};

export function friendlyError(err: { message?: string } | null | undefined, offline = false): string {
  if (offline) return 'No connection. Check the signal and try again.';
  const msg = err?.message ?? '';
  for (const code of Object.keys(MESSAGES)) if (msg.includes(code)) return MESSAGES[code];
  return 'Something went wrong. Try again.';
}

/** True when the request never reached the server (no signal), as opposed to the server refusing it. */
export function isNetworkError(err: { message?: string } | null | undefined): boolean {
  const m = (err?.message ?? '').toLowerCase();
  return ['network request failed', 'failed to fetch', 'network error', 'abort', 'timed out', 'timeout'].some((x) => m.includes(x));
}
