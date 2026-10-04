import { describe, expect, test } from 'vitest';
import { GENERIC_RULES } from '../../src/rules/generic.js';
import { ALL_RULES, runRules } from '../../src/rules/index.js';
import { EMPTY, event } from './helpers.js';

const fired = (text: string, followUps: string[] = []) =>
  runRules(event(text, followUps), EMPTY, GENERIC_RULES).map((f) => f.ruleId);

describe('generic rules', () => {
  test.each([
    ['fix it', ['gen/vague-request']],
    ['add a delete button to the user list', ['gen/no-target', 'gen/no-acceptance']],
    ['add a delete button to `UserListComponent`', ['gen/no-acceptance']],
    ['add a delete button to src/app/users/list.ts so that admins can remove users', []],
    ['Refactor CartService; it must keep the public API and tests should pass', []],
    ['explain how dependency injection works in this repository please', []],
  ])('%s', (text, expected) => {
    expect(fired(text)).toEqual(expected);
  });

  test.each(['sounds good', 'yes please', 'looks good', 'B', 'are you there ?', 'ok', 'LGTM!', 'yes, go ahead', 'thanks', '2', 'option 3', 'continue', 'proceed please'])(
    'short conversational reply is not a vague request: %s',
    (text) => {
      expect(fired(text)).not.toContain('gen/vague-request');
    },
  );

  test.each(['fix it', 'make it faster', 'update the tests', 'it is broken'])('short request is still vague: %s', (text) => {
    expect(fired(text)).toContain('gen/vague-request');
  });

  test('repeated corrections', () => {
    expect(fired('explain how routing works in this app please', ['no', 'still wrong'])).toEqual([
      'gen/repeated-correction',
    ]);
    expect(fired('explain how routing works in this app please', ['no'])).toEqual([]);
  });
});

test('every rule id is unique and has guidance', () => {
  const ids = ALL_RULES.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of ALL_RULES) expect(r.guidance.length).toBeGreaterThan(10);
});
