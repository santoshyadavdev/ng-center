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
