import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('replaceSource swaps all events and findings of one source', () => {
  const store = new Store(':memory:');
  store.replaceSource('/a.jsonl', [
    { event: ev('a1'), findings: [finding] },
    { event: ev('a2'), findings: [finding] },
  ]);
  store.replaceSource('/b.jsonl', [{ event: ev('b1'), findings: [] }]);
  store.saveEvent(ev('loose'), []);

  store.replaceSource('/a.jsonl', [{ event: ev('a1', { text: 'edited' }), findings: [] }]);

  const events = store.listEvents();
  expect(events.map((e) => e.id).sort()).toEqual(['a1', 'b1', 'loose']);
  expect(events.find((e) => e.id === 'a1')).toMatchObject({ text: 'edited', findings: [] });
});

test('adds the source column to a database created before it existed', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ngc-store-')), 'old.db');
  const db = new DatabaseSync(file);
  db.exec(`create table events (id text primary key, agent text not null, session_id text not null, timestamp text not null,
    repo text, text text not null, follow_ups text not null, outcome text not null)`);
  db.close();
  const store = new Store(file);
  store.replaceSource('/a.jsonl', [{ event: ev('a1'), findings: [] }]);
  expect(store.listEvents().map((e) => e.id)).toEqual(['a1']);
  store.close();
});

test('waits for a busy database instead of failing immediately', () => {
  const store = new Store(':memory:');
  const db = (store as unknown as { db: DatabaseSync }).db;
  expect(db.prepare('pragma busy_timeout').get()).toEqual({ timeout: 5000 });
});

test('write transactions take the write lock up front with begin immediate', () => {
  const store = new Store(':memory:');
  const db = (store as unknown as { db: DatabaseSync }).db;
  const statements: string[] = [];
  const exec = db.exec.bind(db);
  db.exec = (sql: string) => (statements.push(sql), exec(sql));
  store.replaceSource('/logs/a.jsonl', [{ event: ev('a'), findings: [] }]);
  store.saveEvent(ev('b'), []);
  expect(statements.filter((s) => s.startsWith('begin'))).toEqual(['begin immediate', 'begin immediate']);
});

test('countEvents counts in SQL with the same filters as listEvents', () => {
  const store = new Store(':memory:');
  store.saveEvent(ev('a'), []);
  store.saveEvent(ev('b', { agent: 'cursor' }), []);
  store.saveEvent(ev('c', { agent: 'cursor', repo: '/work/other' }), []);
  expect(store.countEvents()).toBe(3);
  expect(store.countEvents({ agent: 'cursor' })).toBe(2);
  expect(store.countEvents({ agent: 'cursor', repo: '/work/other' })).toBe(1);
  expect(store.countEvents({ agent: 'copilot' })).toBe(0);
});
