// Timing for the animated splash. Kept separate so the rules can be tested.
export const SPLASH_MAX_MS = 3500;

export type SplashMode = 'full' | 'quick' | 'still';
export type SplashPlan = { mode: SplashMode; fadeStartMs: number; fadeMs: number; totalMs: number };

/**
 * full  : first launch, the whole 3.5 second sequence
 * quick : every later launch, a short 1.2 second version so cashiers are not kept waiting
 * still : for people who turned on "reduce motion": no movement, just a brief fade
 */
export function splashPlan(opts: { firstLaunch: boolean; reduceMotion: boolean }): SplashPlan {
  if (opts.reduceMotion) return { mode: 'still', fadeStartMs: 600, fadeMs: 300, totalMs: 900 };
  if (opts.firstLaunch) return { mode: 'full', fadeStartMs: 3050, fadeMs: 450, totalMs: 3500 };
  return { mode: 'quick', fadeStartMs: 800, fadeMs: 400, totalMs: 1200 };
}

/** Moments in the full sequence, in milliseconds from the start. */
export const BEATS = {
  coinTurn: { at: 0, for: 1100 },       // the coin makes one full turn
  glow: { at: 200, for: 1300 },         // warm light blooms behind it
  ripple1: { at: 700, for: 1300 },      // gold rings spread outward
  ripple2: { at: 1000, for: 1300 },
  shine: { at: 900, for: 700 },         // a band of light sweeps across the coin
  coinLift: { at: 1000, for: 700 },     // the coin moves up to make room for the name
  name: { at: 1500, for: 600 },         // "Fiji Rewards" rises into view
  tagline: { at: 2000, for: 500 },      // "One wallet. Every local shop."
} as const;

export const SPLASH_SEEN_KEY = 'fiji.splashSeen';
