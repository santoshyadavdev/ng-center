import { expect, test } from 'vitest';
import { cleanText, isNoise } from '../../src/ingest/clean.js';
import { isCorrection } from '../../src/ingest/events.js';

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

test('cleanText strips IDE and canvas context blocks', () => {
  expect(cleanText('<ide_opened_file>The user opened a.ts</ide_opened_file> no, use signals')).toBe('no, use signals');
  expect(cleanText('<ide_selection>const a = 1;\n</ide_selection>\nfix this')).toBe('fix this');
  expect(cleanText('<canvas-context>{"a":1}</canvas-context>')).toBe('');
  expect(cleanText('Use <canvas-context>{}</canvas-context> the chart')).toBe('Use  the chart');
  expect(cleanText('<div> wrapper is not rendering')).toBe('<div> wrapper is not rendering');
  expect(cleanText('<span> is misaligned')).toBe('<span> is misaligned');
});

test('wrapped corrections are still detected after cleaning', () => {
  expect(isCorrection(cleanText('<ide_opened_file>x</ide_opened_file> no, use signals'))).toBe(true);
});

test('isNoise flags Claude interruption markers', () => {
  expect(isNoise('[Request interrupted by user]')).toBe(true);
  expect(isNoise('[Request interrupted by user for tool use]')).toBe(true);
});

test('isNoise flags long markdown-H1 skill templates only', () => {
  const body = 'Follow these steps carefully when preparing the change.\n'.repeat(30);
  expect(isNoise(`# Pull Request Creation\n\n${body}`)).toBe(true);
  expect(isNoise('# Bug\nThe cart total is wrong when a coupon is applied')).toBe(false);
  expect(isNoise(`Please review this:\n${body}`)).toBe(false);
  expect(isNoise(`## Context\n${body}`)).toBe(false);
  expect(isNoise(`#ngIf is not rendering\n${body}`)).toBe(false);
});
