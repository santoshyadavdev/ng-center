import { expect, test } from 'vitest';
import { cleanText, isNoise } from '../../src/ingest/clean.js';

test('cleanText strips system reminders and trims', () => {
  expect(cleanText('  hi <system-reminder>secret\nstuff</system-reminder> there ')).toBe('hi  there');
});

test('isNoise flags command echoes and caveats', () => {
  expect(isNoise('<command-name>/clear</command-name>')).toBe(true);
  expect(isNoise('<local-command-stdout></local-command-stdout>')).toBe(true);
  expect(isNoise('Caveat: The messages below were generated')).toBe(true);
  expect(isNoise('')).toBe(true);
  expect(isNoise('Add a login form')).toBe(false);
});

test('isNoise flags agent-generated wrappers and terminal escapes', () => {
  expect(isNoise('<parameter name="prompt">Fix the lint error')).toBe(true);
  expect(isNoise('<system_notification>Agent completed</system_notification>')).toBe(true);
  expect(isNoise('<cross_session_message from="x">hi</cross_session_message>')).toBe(true);
  expect(isNoise('<canvas-context>{}</canvas-context>')).toBe(true);
  expect(isNoise('<65;56;14M')).toBe(true);
  expect(isNoise('\u001b[<65;56;14M<65;57;14m')).toBe(true);
  expect(isNoise('<div> wrapper is not rendering in the header')).toBe(false);
  expect(isNoise('Use <ng-content> for projection')).toBe(false);
});
