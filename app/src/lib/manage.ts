// Rules for the owner's rewards and points-rate forms. The database enforces the same limits.

export type RewardInput = { title: string; points: string; value: string; dailyLimit: string };
export type RewardValues = { title: string; points_cost: number; value_fjd: number; daily_limit: number | null };
export type RewardErrors = Partial<Record<keyof RewardInput, string>>;

export function validateReward(input: RewardInput): { ok: true; values: RewardValues } | { ok: false; errors: RewardErrors } {
  const errors: RewardErrors = {};
  const title = input.title.trim();
  if (title.length < 3 || title.length > 60) errors.title = 'Give it a name of 3 to 60 letters, like "Free coffee".';

  const points = input.points.trim();
  if (!/^\d{1,6}$/.test(points) || Number(points) < 1) errors.points = 'Enter how many points it costs, like 100.';

  const value = input.value.trim().replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) errors.value = 'Enter what it is worth in FJD, like 5 or 5.50.';

  const limit = input.dailyLimit.trim();
  if (limit !== '' && (!/^\d{1,5}$/.test(limit) || Number(limit) < 1)) errors.dailyLimit = 'Leave blank for no limit, or enter a number like 20.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { title, points_cost: Number(points), value_fjd: Number(value), daily_limit: limit === '' ? null : Number(limit) } };
}

export type RewardWindow = { active_from: string; active_to: string | null };

export function rewardStatus(r: RewardWindow, now = new Date()): 'live' | 'scheduled' | 'ended' {
  if (new Date(r.active_from) > now) return 'scheduled';
  if (r.active_to && new Date(r.active_to) <= now) return 'ended';
  return 'live';
}

/** When ending a reward: now, or its start time if it has not started (so the end is never before the start). */
export function endTimestamp(r: RewardWindow, now = new Date()): string {
  return new Date(Math.max(now.getTime(), Date.parse(r.active_from))).toISOString();
}

/** A points rate like "1", "1.5" or "2.25" inside the network limits, else null. */
export function parseRate(input: string, min: number, max: number): number | null {
  const t = input.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}
