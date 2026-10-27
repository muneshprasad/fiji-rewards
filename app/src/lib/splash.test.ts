import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEATS, SPLASH_MAX_MS, splashPlan } from './splash.ts';

test('the first launch is the full 3.5 second sequence and never longer', () => {
  const p = splashPlan({ firstLaunch: true, reduceMotion: false });
  assert.equal(p.mode, 'full');
  assert.equal(p.totalMs, 3500);
  assert.equal(p.fadeStartMs + p.fadeMs, p.totalMs);
  assert.ok(p.totalMs <= SPLASH_MAX_MS);
});

test('later launches are short so cashiers are not kept waiting', () => {
  const p = splashPlan({ firstLaunch: false, reduceMotion: false });
  assert.equal(p.mode, 'quick');
  assert.ok(p.totalMs <= 1500);
});

test('reduce motion gets no movement and the shortest time, even on first launch', () => {
  for (const firstLaunch of [true, false]) {
    const p = splashPlan({ firstLaunch, reduceMotion: true });
    assert.equal(p.mode, 'still');
    assert.ok(p.totalMs <= 1000);
  }
});

test('every beat of the full sequence finishes before the fade-out starts', () => {
  const full = splashPlan({ firstLaunch: true, reduceMotion: false });
  for (const [name, b] of Object.entries(BEATS)) {
    assert.ok(b.at + b.for <= full.fadeStartMs, `${name} ends at ${b.at + b.for}ms, after the fade starts at ${full.fadeStartMs}ms`);
  }
  // the name appears only after the coin has started to move up, so the two do not collide
  assert.ok(BEATS.name.at >= BEATS.coinLift.at);
  assert.ok(BEATS.tagline.at >= BEATS.name.at);
});
