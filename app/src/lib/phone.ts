// Fiji numbers: country code 679, then 7 digits. Mobiles start with 7, 8 or 9.
const FIJI_LOCAL = /^[2-9][0-9]{6}$/;

/** Returns the number as +679XXXXXXX, or null if it is not a valid Fiji number. */
export function normalizeFijiPhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('679')) digits = digits.slice(3);
  return FIJI_LOCAL.test(digits) ? `+679${digits}` : null;
}

/** For display: +679 700 1234 */
export function formatFijiPhone(e164: string): string {
  const m = /^\+679(\d{3})(\d{4})$/.exec(e164);
  return m ? `+679 ${m[1]} ${m[2]}` : e164;
}
