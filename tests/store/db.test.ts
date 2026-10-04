import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Finding, PromptEvent } from '../../src/core/index.js';
import { Store } from '../../src/store/index.js';

const ev = (id: string, over: Partial<PromptEvent> = {}): PromptEvent => ({
  id,
  agent: 'claude-code',
  sessionId: 's1',
  timestamp: '2026-10-03T08:00:00.000Z',
  repo: '/work/app',
  text: `prompt ${id}`,
  followUps: [],
  outcome: 'accepted',
  ...over,
});
const finding: Finding = { ruleId: 'gen/vague-request', severity: 'warn', message: 'm', evidence: 'fix it' };

test('creates the parent folder for a file database', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'ngc-store-')), 'nested');
  const store = new Store(join(dir, 'ngcoach.db'));
  store.close();
  expect(existsSync(join(dir, 'ngcoach.db'))).toBe(true);
});

test('saves events with findings and replaces findings on re-save', () => {
  const store = new Store(':memory:');
  store.saveEvent(ev('a', { followUps: ['no'], outcome: 'retried' }), [finding, { ...finding, ruleId: 'gen/no-target' }]);
  store.saveEvent(ev('a', { followUps: ['no'], outcome: 'retried' }), [finding]);
  const [stored] = store.listEvents();
  expect(stored).toMatchObject({ id: 'a', followUps: ['no'], outcome: 'retried' });
  expect(stored?.findings).toEqual([finding]);
});

test('filters by repo, agent and since, newest first', () => {
  const store = new Store(':memory:');
  store.saveEvent(ev('old', { timestamp: '2026-09-01T00:00:00.000Z' }), []);
  store.saveEvent(ev('new', { timestamp: '2026-10-02T00:00:00.000Z' }), []);
  store.saveEvent(ev('other', { repo: '/work/other', agent: 'cursor' }), []);
  expect(store.listEvents().map((e) => e.id)).toEqual(['other', 'new', 'old']);
  expect(store.listEvents({ repo: '/work/app' }).map((e) => e.id)).toEqual(['new', 'old']);
  expect(store.listEvents({ agent: 'cursor' }).map((e) => e.id)).toEqual(['other']);
  expect(store.listEvents({ since: '2026-10-01T00:00:00.000Z' }).map((e) => e.id)).toEqual(['other', 'new']);
});

test('checkpoints, adapter stats and clear', () => {
  const store = new Store(':memory:');
  expect(store.getCheckpoint('/a.jsonl')).toBeNull();
  store.setCheckpoint('/a.jsonl', 'claude-code', 123);
  expect(store.getCheckpoint('/a.jsonl')).toBe(123);

  const stats = { adapter: 'cursor' as const, sources: 1, events: 2, skipped: 3, error: 'boom', scannedAt: '2026-10-03T00:00:00.000Z' };
  store.setAdapterStats(stats);
  store.setAdapterStats({ ...stats, events: 5, error: null });
  expect(store.listAdapterStats()).toEqual([{ ...stats, events: 5, error: null }]);

  store.saveEvent(ev('a'), [finding]);
  store.clear();
  expect(store.listEvents()).toEqual([]);
  expect(store.getCheckpoint('/a.jsonl')).toBeNull();
  expect(store.listAdapterStats()).toEqual([]);
});
