import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
  expect(out.join('')).toBe('No prompts matched the filters.\n');

  const file = join(env.NGCOACH_HOME!, 'report.html');
  out = [];
  expect(run('report', '--html', file)).toBe(0);
  expect(readFileSync(file, 'utf8')).toContain('ng/control-flow');
  expect(out.join('')).toContain(file);
});

test('an empty database still hints at scan even with filters', () => {
  expect(run('report', '--agent', 'cursor')).toBe(0);
  expect(out.join('')).toContain('ngcoach scan');
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
  expect(run('report', '--json', '--html', join(env.NGCOACH_HOME!, 'x.html'))).toBe(2);
  expect(out.join('')).toMatch(/--json.*--html/);
  out = [];
  expect(run('help')).toBe(0);
  expect(out.join('')).toContain('Usage: ngcoach');
});

test('--repo accepts relative paths, trailing slashes and subdirectories of the project', () => {
  const projectDir = join(env.NGCOACH_AGENT_HOME!, '.claude', 'projects', '-work-ng20-src-app');
  mkdirSync(projectDir, { recursive: true });
  const ts = new Date().toISOString();
  const cwd = join(ng20, 'src', 'app');
  const lines = [
    { type: 'user', sessionId: 's2', timestamp: ts, cwd, message: { role: 'user', content: 'In Angular 20, loop with *ngFor' } },
    { type: 'assistant', sessionId: 's2', timestamp: ts, cwd, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
  ];
  writeFileSync(join(projectDir, 's2.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  run('scan');

  for (const repo of [relative(process.cwd(), ng20), relative(process.cwd(), cwd) || '.', `${ng20}/`, `${cwd}/`]) {
    out = [];
    expect(run('report', '--json', '--repo', repo)).toBe(0);
    const report = JSON.parse(out.join(''));
    expect(report.prompts.map((p: { repo: string }) => p.repo)).toEqual([ng20, ng20]);
  }
});

test('I/O errors print one ngcoach: line and exit 1', () => {
  run('scan');
  out = [];
  expect(run('report', '--html', '/nonexistent/dir/x.html')).toBe(1);
  const text = out.join('');
  expect(text).toMatch(/^ngcoach: .*ENOENT.*\/nonexistent\/dir\/x\.html.*\n$/);
  expect(text.trim().split('\n')).toHaveLength(1);
});

test('scan prints the summary and exits 1 when an adapter reports an error', () => {
  const bad = join(env.NGCOACH_AGENT_HOME!, '.claude', 'projects', '-work-ng20', 'locked.jsonl');
  writeFileSync(bad, '');
  chmodSync(bad, 0o000);
  expect(run('scan')).toBe(1);
  const text = out.join('');
  expect(text).toMatch(/claude-code\s+2 sources\s+1 event\s+0 skipped\s+error: .*locked\.jsonl/);
  expect(text).toMatch(/copilot\s+/);
});
