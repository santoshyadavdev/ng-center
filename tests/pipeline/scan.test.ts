import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ProjectProfile, RawTurn } from '../../src/core/index.js';
import type { Adapter } from '../../src/ingest/index.js';
import { scan, sourceMtime } from '../../src/pipeline/scan.js';
import { Store } from '../../src/store/index.js';
import { ANGULAR_20 } from '../rules/helpers.js';

const turn = (sessionId: string, index: number, role: RawTurn['role'], text: string): RawTurn => ({
  agent: 'claude-code',
  sessionId,
  index,
  timestamp: `2026-10-03T08:00:0${index}.000Z`,
  role,
  text,
  cwd: '/work/app',
});

function fakeAdapter(reads: Record<string, () => { turns: RawTurn[]; skipped: number }>, calls: string[]): Adapter {
  return {
    id: 'claude-code',
    discover: () => Object.keys(reads),
    read: (source) => {
      calls.push(source);
      return reads[source]!();
    },
  };
}

const NOW = () => new Date('2026-10-03T09:00:00.000Z');

test('ingests events, applies rules with the repo profile and records stats', () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  const profiles: string[] = [];
  const adapter = fakeAdapter(
    {
      '/logs/a.jsonl': () => ({
        turns: [turn('a', 0, 'user', 'Angular 20: wrap the list in *ngIf'), turn('a', 1, 'assistant', 'ok')],
        skipped: 1,
      }),
      '/logs/b.jsonl': () => {
        throw new Error('bad file');
      },
    },
    calls,
  );
  const profile = (repo: string): ProjectProfile => (profiles.push(repo), ANGULAR_20);

  const result = scan({ store, adapters: [adapter], home: '/home', profile, mtime: () => 1, now: NOW });

  expect(result.adapters).toEqual([
    {
      adapter: 'claude-code',
      sources: 2,
      events: 1,
      skipped: 1,
      error: '/logs/b.jsonl: bad file',
      scannedAt: '2026-10-03T09:00:00.000Z',
    },
  ]);
  expect(profiles).toEqual(['/work/app']);
  const [event] = store.listEvents();
  expect(event?.findings.map((f) => f.ruleId)).toEqual(['ng/control-flow']);
  expect(store.listAdapterStats()).toEqual(result.adapters);
});

test('skips unchanged sources, re-reads changed ones, rebuild starts fresh', () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  const adapter = fakeAdapter(
    { '/logs/a.jsonl': () => ({ turns: [turn('a', 0, 'user', 'explain the router setup in this app')], skipped: 0 }) },
    calls,
  );
  let mtime = 1;
  const opts = { store, adapters: [adapter], home: '/home', mtime: () => mtime, now: NOW };

  scan(opts);
  scan(opts);
  expect(calls).toHaveLength(1);

  mtime = 2;
  scan(opts);
  expect(calls).toHaveLength(2);

  scan({ ...opts, rebuild: true });
  expect(calls).toHaveLength(3);
  expect(store.listEvents()).toHaveLength(1);
});

test('an adapter whose discover throws is reported and others still run', () => {
  const store = new Store(':memory:');
  const broken: Adapter = {
    id: 'cursor',
    discover: () => {
      throw new Error('no access');
    },
    read: () => ({ turns: [], skipped: 0 }),
  };
  const ok = fakeAdapter({ '/logs/a.jsonl': () => ({ turns: [turn('a', 0, 'user', 'hello there agent friend')], skipped: 0 }) }, []);

  const result = scan({ store, adapters: [broken, ok], home: '/home', mtime: () => 1, now: NOW });

  expect(result.adapters.map((a) => [a.adapter, a.error, a.events])).toEqual([
    ['cursor', 'discover: no access', 0],
    ['claude-code', null, 1],
  ]);
});

test('sourceMtime uses the newer of a file and its -wal sibling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ngc-wal-'));
  const db = join(dir, 'state.vscdb');
  writeFileSync(db, '');
  utimesSync(db, 100, 100);
  expect(sourceMtime(db)).toBe(100_000);

  writeFileSync(`${db}-wal`, '');
  utimesSync(`${db}-wal`, 200, 200);
  expect(sourceMtime(db)).toBe(200_000);

  utimesSync(db, 300, 300);
  expect(sourceMtime(db)).toBe(300_000);
});

test('a re-read source with fewer events leaves no stale rows', () => {
  const store = new Store(':memory:');
  let turns = [
    turn('a', 0, 'user', 'Angular 20: wrap the list in *ngIf'),
    turn('a', 1, 'assistant', 'ok'),
    turn('a', 2, 'user', 'now explain the router setup in this app'),
  ];
  const adapter = fakeAdapter({ '/logs/a.jsonl': () => ({ turns, skipped: 0 }) }, []);
  let mtime = 1;
  const opts = { store, adapters: [adapter], home: '/home', profile: () => ANGULAR_20, mtime: () => mtime, now: NOW };

  scan(opts);
  expect(store.listEvents()).toHaveLength(2);

  turns = [turn('a', 0, 'user', 'explain the router setup in this app please')];
  mtime = 2;
  scan(opts);
  const events = store.listEvents();
  expect(events.map((e) => e.text)).toEqual(['explain the router setup in this app please']);
  expect(events[0]?.findings).toEqual([]);
});

test('a source that fails is not counted or checkpointed, and is re-read on the next scan', () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  const adapter = fakeAdapter(
    { '/logs/a.jsonl': () => ({ turns: [turn('a', 0, 'user', 'explain the router setup in this app')], skipped: 2 }) },
    calls,
  );
  const replace = store.replaceSource.bind(store);
  let fail = true;
  store.replaceSource = (source, entries) => {
    if (fail) throw new Error('disk I/O error');
    replace(source, entries);
  };
  const opts = { store, adapters: [adapter], home: '/home', profile: () => ANGULAR_20, mtime: () => 1, now: NOW };

  const first = scan(opts);
  expect(first.adapters[0]).toMatchObject({ events: 0, skipped: 0, error: '/logs/a.jsonl: disk I/O error' });
  expect(store.getCheckpoint('/logs/a.jsonl')).toBeNull();

  fail = false;
  const second = scan(opts);
  expect(calls).toEqual(['/logs/a.jsonl', '/logs/a.jsonl']);
  expect(second.adapters[0]).toMatchObject({ events: 1, skipped: 2, error: null });
  expect(store.getCheckpoint('/logs/a.jsonl')).toBe(1);
});

test('a failure saving adapter stats does not abort the remaining adapters', () => {
  const store = new Store(':memory:');
  const first = { ...fakeAdapter({ '/logs/a.jsonl': () => ({ turns: [], skipped: 0 }) }, []), id: 'cursor' as const };
  const second = fakeAdapter(
    { '/logs/b.jsonl': () => ({ turns: [turn('b', 0, 'user', 'explain the router setup in this app')], skipped: 0 }) },
    [],
  );
  const save = store.setAdapterStats.bind(store);
  store.setAdapterStats = (s) => {
    if (s.adapter === 'cursor') throw new Error('database is locked');
    save(s);
  };

  const result = scan({ store, adapters: [first, second], home: '/home', profile: () => ANGULAR_20, mtime: () => 1, now: NOW });

  expect(result.adapters.map((a) => [a.adapter, a.error])).toEqual([
    ['cursor', 'stats: database is locked'],
    ['claude-code', null],
  ]);
  expect(store.listEvents()).toHaveLength(1);
});
