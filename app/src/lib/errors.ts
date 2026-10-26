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
  insufficient_points: 'The customer does not have enough points.',
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
  return m.includes('network request failed') || m.includes('failed to fetch') || m.includes('network error');
}
