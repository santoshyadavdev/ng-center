import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { claudeCode } from '../../src/ingest/claude-code.js';
import { buildEvents } from '../../src/ingest/events.js';

const home = fileURLToPath(new URL('../fixtures/agent-home', import.meta.url));

test('discovers session jsonl files', () => {
  const sources = claudeCode.discover(home);
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatch(/session-a\.jsonl$/);
});

test('reads prompts, ignores tool results/sidechains/commands, counts malformed records', () => {
  const { turns, skipped } = claudeCode.read(claudeCode.discover(home)[0]!);
  expect(skipped).toBe(2);
  expect(turns.map((t) => [t.role, t.text])).toEqual([
    ['user', 'Create a product list component using *ngFor'],
    ['assistant', 'Here is the component.'],
    ['user', 'no, use signals for the list'],
    ['assistant', 'Updated.'],
  ]);
  expect(turns[0]).toMatchObject({ agent: 'claude-code', sessionId: 'sess-a', cwd: '/work/shop' });

  const events = buildEvents(turns);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outcome: 'retried', followUps: ['no, use signals for the list'] });
});
