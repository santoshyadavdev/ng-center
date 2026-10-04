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
