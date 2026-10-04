import { expect, test } from 'vitest';
import { patternRule } from '../../src/rules/pattern-rule.js';
import { ANGULAR_16, ANGULAR_20, EMPTY, event } from './helpers.js';

const rule = patternRule({
  id: 'test/ngif',
  severity: 'warn',
  guidance: 'Use @if.',
  angularRange: '>=17',
  match: (text) => text.match(/\*ngIf/)?.[0] ?? null,
  message: (evidence, profile) => `${evidence} on ${profile.angularVersion}`,
});

test('fires with evidence and a dynamic message', () => {
  expect(rule.check(event('use *ngIf here'), ANGULAR_20)).toEqual({
    ruleId: 'test/ngif',
    severity: 'warn',
    message: '*ngIf on 20.1.0',
    evidence: '*ngIf',
  });
});

test('respects the Angular version range and unknown versions', () => {
  expect(rule.check(event('use *ngIf here'), ANGULAR_16)).toBeNull();
  expect(rule.check(event('use *ngIf here'), EMPTY)).toBeNull();
  expect(rule.check(event('use *ngIf here'), { ...ANGULAR_20, angularVersion: 'unknown' })).toBeNull();
});

test('respects requiresAngular and when()', () => {
  const r = patternRule({
    id: 'test/when',
    severity: 'info',
    guidance: 'g',
    requiresAngular: true,
    when: (p) => p.standalone,
    match: (t) => (t.includes('x') ? 'x' : null),
    message: 'm',
  });
  expect(r.check(event('x'), EMPTY)).toBeNull();
  expect(r.check(event('x'), ANGULAR_16)).toBeNull();
  expect(r.check(event('x'), ANGULAR_20)?.message).toBe('m');
  expect(r.check(event('y'), ANGULAR_20)).toBeNull();
});
