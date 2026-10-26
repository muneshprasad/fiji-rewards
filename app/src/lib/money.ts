export const MAX_SALE_FJD = 500;

/** Parses a typed bill amount like "12", "12.5" or "12.50". Returns null if invalid or over the limit. */
export function parseAmount(input: string, max = MAX_SALE_FJD): number | null {
  const t = input.trim().replace(/^FJD\s*/i, '').replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= max ? n : null;
}

/** Same rule as the database: points = floor(amount x rate). */
export const pointsFor = (amount: number, rate: number) => Math.floor(Math.round(amount * rate * 100) / 100);

export const fjd = (n: number) => `FJD ${n.toFixed(2)}`;
