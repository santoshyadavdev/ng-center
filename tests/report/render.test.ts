import { expect, test } from 'vitest';
import { rankEvents, renderHtml, renderJson, renderText } from '../../src/report/index.js';
import type { StoredEvent } from '../../src/store/index.js';

const event: StoredEvent = {
  id: 'e1',
  agent: 'cursor',
  sessionId: 's',
  timestamp: '2026-10-03T08:00:00.000Z',
  repo: '/work/app',
  text: 'wrap <ul> in *ngIf',
  followUps: ['no, keep it'],
  outcome: 'retried',
  findings: [
    { ruleId: 'ng/control-flow', severity: 'warn', message: 'Asked for *ngIf, but Angular 20.1.0 has @if.', evidence: '*ngIf' },
  ],
};
const ranked = rankEvents([event]);

test('text report shows prompt, findings and rule guidance', () => {
  const out = renderText(ranked);
  expect(out).toContain('1. [cursor] 2026-10-03 /work/app  score 5');
  expect(out).toContain('wrap <ul> in *ngIf');
  expect(out).toContain('warn  ng/control-flow: Asked for *ngIf, but Angular 20.1.0 has @if.');
  expect(out).toContain('→ This project supports built-in control flow.');
  expect(out).toContain('1 follow-up correction');
});

test('text report empty state hints at scan', () => {
  expect(renderText([])).toContain('ngcoach scan');
});

test('empty state says when filters excluded every prompt', () => {
  expect(renderText([], { filtered: true })).toBe('No prompts matched the filters.\n');
  const html = renderHtml([], { filtered: true });
  expect(html).toContain('No prompts matched the filters.');
  expect(html).not.toContain('ngcoach scan');
});

test('json report is machine readable', () => {
  const parsed = JSON.parse(renderJson(ranked));
  expect(parsed.prompts[0]).toMatchObject({ id: 'e1', score: 5, agent: 'cursor', findings: [{ ruleId: 'ng/control-flow' }] });
});

test('html report is self-contained and escaped', () => {
  const html = renderHtml(ranked);
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).toContain('wrap &lt;ul&gt; in *ngIf');
  expect(html).not.toContain('<ul>');
  expect(html).not.toMatch(/<(script|link)\b/);
});
