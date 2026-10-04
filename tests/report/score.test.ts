import { expect, test } from 'vitest';
import type { Finding } from '../../src/core/index.js';
import { rankEvents, weaknessScore } from '../../src/report/index.js';
import type { StoredEvent } from '../../src/store/index.js';

const warn: Finding = { ruleId: 'gen/vague-request', severity: 'warn', message: 'm', evidence: 'e' };
const info: Finding = { ruleId: 'gen/no-target', severity: 'info', message: 'm', evidence: 'e' };

const ev = (id: string, over: Partial<StoredEvent> = {}): StoredEvent => ({
  id,
  agent: 'claude-code',
  sessionId: 's',
  timestamp: '2026-10-03T08:00:00.000Z',
  repo: null,
  text: id,
  followUps: [],
  outcome: 'accepted',
  findings: [],
  ...over,
});

test('weaknessScore weights corrections, warnings and bad outcomes', () => {
  expect(weaknessScore(ev('clean', { findings: [info] }))).toBe(0);
  expect(weaknessScore(ev('warn', { findings: [warn, info] }))).toBe(1);
  expect(weaknessScore(ev('abandoned', { outcome: 'abandoned' }))).toBe(2);
  expect(weaknessScore(ev('retried', { outcome: 'retried', followUps: ['no', 'no'], findings: [warn] }))).toBe(7);
});

test('rankEvents drops zero scores, sorts by score then recency, and limits', () => {
  const events = [
    ev('zero'),
    ev('one-old', { findings: [warn], timestamp: '2026-10-01T00:00:00.000Z' }),
    ev('one-new', { findings: [warn], timestamp: '2026-10-02T00:00:00.000Z' }),
    ev('seven', { outcome: 'retried', followUps: ['a', 'b'], findings: [warn] }),
  ];
  expect(rankEvents(events).map((r) => [r.event.id, r.score])).toEqual([
    ['seven', 7],
    ['one-new', 1],
    ['one-old', 1],
  ]);
  expect(rankEvents(events, 1)).toHaveLength(1);
});
