import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFijiPhone, formatFijiPhone } from './phone.ts';

test('accepts common ways of typing a Fiji number', () => {
  for (const s of ['7001234', '700 1234', '+679 700 1234', '6797001234', '00679 700-1234', '(679) 7001234']) {
    assert.equal(normalizeFijiPhone(s), '+6797001234', s);
  }
});

test('rejects bad numbers', () => {
  for (const s of ['', '123', '70012345', '1001234', '+61412345678', 'abcdefg']) {
    assert.equal(normalizeFijiPhone(s), null, s);
  }
});

test('formats for display', () => {
  assert.equal(formatFijiPhone('+6797001234'), '+679 700 1234');
});
