import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { copilot } from '../../src/ingest/copilot.js';

const home = fileURLToPath(new URL('../fixtures/agent-home', import.meta.url));

test('discovers events.jsonl per session', () => {
  expect(copilot.discover(home)).toEqual([expect.stringMatching(/sess-b[\\/]events\.jsonl$/)]);
});

test('reads user/assistant messages with session cwd and skips malformed', () => {
  const { turns, skipped } = copilot.read(copilot.discover(home)[0]!);
  expect(skipped).toBe(1);
  expect(turns.map((t) => [t.role, t.text])).toEqual([
    ['user', 'Add a login form'],
    ['assistant', 'Added LoginComponent.'],
  ]);
  expect(turns[0]).toMatchObject({ agent: 'copilot', sessionId: 'sess-b', cwd: '/work/admin' });
});

test('does not emit injected system notifications or canvas context as prompts', () => {
  const { turns } = copilot.read(copilot.discover(home)[0]!);
  const texts = turns.map((t) => t.text);
  expect(texts.some((t) => t.includes('system_notification') || t.includes('Agent "explore" completed'))).toBe(false);
  expect(texts.some((t) => t.includes('canvas'))).toBe(false);
  expect(turns.filter((t) => t.role === 'user')).toHaveLength(1);
});

function sessionFile(events: object[]): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ngc-copilot-')), 'sess-r');
  mkdirSync(dir);
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const prompt = { type: 'user.message', timestamp: '2026-10-02T10:00:10.000Z', data: { content: 'Add a guard', source: 'user' } };
const resume = (cwd: string) => ({ type: 'session.resume', timestamp: '2026-10-02T10:00:00.000Z', data: { context: { cwd } } });
const start = (cwd: string) => ({ type: 'session.start', timestamp: '2026-10-02T09:00:00.000Z', data: { context: { cwd } } });

test('takes cwd from session.resume when no session.start cwd was seen', () => {
  const { turns } = copilot.read(sessionFile([resume('/work/resumed'), prompt]));
  expect(turns[0]).toMatchObject({ sessionId: 'sess-r', cwd: '/work/resumed' });
});

test('prefers the session.start cwd over session.resume', () => {
  const { turns } = copilot.read(sessionFile([start('/work/started'), resume('/work/resumed'), prompt]));
  expect(turns[0]?.cwd).toBe('/work/started');
});
