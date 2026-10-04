import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from 'vitest';
import { main } from '../../src/cli/main.js';

const ng20 = fileURLToPath(new URL('../fixtures/repos/ng20-standalone', import.meta.url));
let env: Record<string, string>;
let out: string[];
const write = (s: string) => void out.push(s);
const run = (...argv: string[]) => main(argv, write, env);

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'ngc-cli-'));
  env = { NGCOACH_HOME: join(root, 'state'), NGCOACH_AGENT_HOME: join(root, 'home') };
  out = [];
  const projectDir = join(env.NGCOACH_AGENT_HOME!, '.claude', 'projects', '-work-ng20');
  mkdirSync(projectDir, { recursive: true });
  const ts = new Date().toISOString();
  const lines = [
    { type: 'user', sessionId: 's1', timestamp: ts, cwd: ng20, message: { role: 'user', content: 'In Angular 20, wrap the list in *ngIf' } },
    { type: 'assistant', sessionId: 's1', timestamp: ts, cwd: ng20, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
  ];
  writeFileSync(join(projectDir, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
});

test('scan then report --json end to end', () => {
  expect(run('scan')).toBe(0);
  expect(out.join('')).toMatch(/claude-code\s+1 sources?\s+1 events?/);

  out = [];
  expect(run('report', '--json', '--since', '7d', '--repo', ng20)).toBe(0);
  const report = JSON.parse(out.join(''));
  expect(report.prompts).toHaveLength(1);
  expect(report.prompts[0].findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(['ng/control-flow']);
});

test('report text, html file and filters', () => {
  run('scan');
  out = [];
  expect(run('report')).toBe(0);
  expect(out.join('')).toContain('ng/control-flow');

  out = [];
  expect(run('report', '--agent', 'cursor')).toBe(0);
  expect(out.join('')).toContain('ngcoach scan');

  const file = join(env.NGCOACH_HOME!, 'report.html');
  out = [];
  expect(run('report', '--html', file)).toBe(0);
  expect(readFileSync(file, 'utf8')).toContain('ng/control-flow');
  expect(out.join('')).toContain(file);
});

test('rebuild re-reads everything', () => {
  run('scan');
  out = [];
  run('scan');
  expect(out.join('')).toMatch(/claude-code\s+1 source\s+0 events/);
  out = [];
  run('scan', '--rebuild');
  expect(out.join('')).toMatch(/claude-code\s+1 source\s+1 event\b/);
});

test('doctor reports adapters and stored totals', () => {
  run('scan');
  out = [];
  expect(run('doctor')).toBe(0);
  const text = out.join('');
  expect(text).toMatch(/claude-code\s+ok\s+1 source/);
  expect(text).toMatch(/1 stored event/);
  expect(text).toContain(env.NGCOACH_HOME!);
});

test('bad input exits with 2 and usage', () => {
  expect(run('nope')).toBe(2);
  expect(out.join('')).toContain('Usage: ngcoach');
  out = [];
  expect(run('report', '--since', 'yesterday')).toBe(2);
  expect(out.join('')).toContain('--since');
  out = [];
  expect(run('report', '--agent', 'vim')).toBe(2);
  out = [];
  expect(run('help')).toBe(0);
  expect(out.join('')).toContain('Usage: ngcoach');
});
