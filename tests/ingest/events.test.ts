import { describe, expect, test } from 'vitest';
import type { RawTurn } from '../../src/core/index.js';
import { buildEvents, isCorrection } from '../../src/ingest/events.js';

const turn = (index: number, role: RawTurn['role'], text: string, sessionId = 's1'): RawTurn => ({
  agent: 'claude-code',
  sessionId,
  index,
  timestamp: `2026-10-01T10:00:0${index}.000Z`,
  role,
  text,
  cwd: '/work/shop',
});

describe('isCorrection', () => {
  test.each([
    ['no, use signals for the list', true],
    ["don't use NgModule", true],
    ['it didn\'t compile', true],
    ['Actually make it a pipe', true],
    ['please use inject() instead', true],
    ['still failing', true],
    ['Now add tests for it', false],
    ['Add a login form', false],
  ])('%s -> %s', (text, expected) => {
    expect(isCorrection(text)).toBe(expected);
  });

  test('accepts typographic apostrophes', () => {
    expect(isCorrection('don’t use NgModule')).toBe(true);
  });
});

describe('buildEvents', () => {
  test('groups corrections after a reply as follow-ups', () => {
    const events = buildEvents([
      turn(0, 'user', 'Create a product list'),
      turn(1, 'assistant', 'done'),
      turn(2, 'user', 'no, use signals'),
      turn(3, 'assistant', 'fixed'),
      turn(4, 'user', 'Now add tests'),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      text: 'Create a product list',
      followUps: ['no, use signals'],
      outcome: 'retried',
      repo: '/work/shop',
      agent: 'claude-code',
      sessionId: 's1',
      timestamp: '2026-10-01T10:00:00.000Z',
    });
    expect(events[1]).toMatchObject({ text: 'Now add tests', followUps: [], outcome: 'abandoned' });
  });

  test('a correction without an intervening reply starts a new event', () => {
    const events = buildEvents([turn(0, 'user', 'Add a form'), turn(1, 'user', 'no wait, a dialog')]);
    expect(events.map((e) => e.text)).toEqual(['Add a form', 'no wait, a dialog']);
  });

  test('accepted when replied without corrections; ids are stable and per-session', () => {
    const turns = [turn(1, 'assistant', 'hi'), turn(0, 'user', 'Add a form'), turn(0, 'user', 'Other', 's2')];
    const a = buildEvents(turns);
    const b = buildEvents([...turns].reverse());
    expect(a.find((e) => e.sessionId === 's1')?.outcome).toBe('accepted');
    expect(a.map((e) => e.id).sort()).toEqual(b.map((e) => e.id).sort());
    expect(new Set(a.map((e) => e.id)).size).toBe(2);
  });
});
