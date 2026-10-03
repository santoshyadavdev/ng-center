# ngcoach Plan 1: Personal Coach (no LLM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `ngcoach` CLI that reads prompts from Claude Code, Copilot CLI and Cursor logs, profiles the Angular project each prompt was written in, runs a deterministic rulebook, stores results in local SQLite, and reports the weakest prompts with Angular-aware guidance. No LLM is used.

**Architecture:** A single ESM TypeScript package with one folder per module (`core`, `ingest`, `context`, `rules`, `store`, `pipeline`, `report`, `cli`). Adapters turn agent logs into `RawTurn`s. `buildEvents` groups the turns into `PromptEvent`s with follow-ups and an outcome. The pipeline profiles each repo, runs the rules and persists everything through `Store`. The report ranks events by a weakness score.

**Tech Stack:** Node >=22.13 (`node:sqlite`), TypeScript 5.9 (NodeNext, strict), zod 3, semver 7, Vitest 3, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-angular-prompt-coach-design.md`

---

## File Map

```
package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, .gitignore, README.md
src/bin.ts                     CLI entry (shebang)
src/core/types.ts              shared types
src/core/hash.ts               stableId
src/core/index.ts
src/util/fs.ts                 listFiles
src/config/paths.ts            ngcoachHome, agentHome
src/ingest/adapter.ts          Adapter interface
src/ingest/clean.ts            cleanText
src/ingest/events.ts           isCorrection, buildEvents
src/ingest/claude-code.ts
src/ingest/copilot.ts
src/ingest/cursor.ts
src/ingest/index.ts            ADAPTERS registry
src/context/profile.ts         buildProfile, EMPTY_PROFILE
src/context/index.ts
src/rules/pattern-rule.ts      patternRule factory
src/rules/generic.ts
src/rules/angular.ts
src/rules/index.ts             ALL_RULES, runRules
src/store/db.ts                Store
src/pipeline/scan.ts           scan()
src/report/score.ts            weaknessScore, rankEvents
src/report/render.ts           renderText, renderJson, renderHtml
src/cli/main.ts                main(argv, write)
tests/**                       mirrors src; fixtures under tests/fixtures
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `tests/smoke.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ngcoach",
  "version": "0.1.0",
  "description": "Angular-aware prompt coach for AI coding agents",
  "type": "module",
  "license": "MIT",
  "bin": { "ngcoach": "dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=22.13" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm add zod@^3 semver@^7 && pnpm add -D typescript@~5.9 vitest@^3 @types/node@^22 @types/semver@^7`
Expected: `node_modules` and `pnpm-lock.yaml` are created.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests", "vitest.config.ts"],
  "exclude": ["tests/fixtures"]
}
```

- [ ] **Step 4: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "declaration": false },
  "include": ["src"]
}
```

- [ ] **Step 5: Create vitest.config.ts and .gitignore**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`:
```
node_modules
dist
*.db
```

- [ ] **Step 6: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

test('node:sqlite is available', () => {
  const db = new DatabaseSync(':memory:');
  expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 });
});
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 1 test passes and typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold ngcoach package"
```

---

### Task 2: Core types and stable IDs

**Files:**
- Create: `src/core/types.ts`, `src/core/hash.ts`, `src/core/index.ts`
- Test: `tests/core/hash.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/hash.test.ts`:
```ts
import { expect, test } from 'vitest';
import { stableId } from '../../src/core/index.js';

test('stableId is deterministic, 16 hex chars, and part-sensitive', () => {
  const a = stableId('claude-code', 's1', 0);
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(stableId('claude-code', 's1', 0)).toBe(a);
  expect(stableId('claude-code', 's1', 1)).not.toBe(a);
  expect(stableId('claude-code', 's', '10')).not.toBe(stableId('claude-code', 's1', '0'));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/core/hash.test.ts`
Expected: FAIL, cannot find module `src/core/index.js`.

- [ ] **Step 3: Implement**

`src/core/types.ts`:
```ts
export type AgentId = 'claude-code' | 'copilot' | 'cursor';
export type Outcome = 'accepted' | 'retried' | 'abandoned';
export type Severity = 'info' | 'warn';

export interface RawTurn {
  agent: AgentId;
  sessionId: string;
  index: number;
  timestamp: string;
  role: 'user' | 'assistant';
  text: string;
  cwd: string | null;
}

export interface PromptEvent {
  id: string;
  agent: AgentId;
  sessionId: string;
  timestamp: string;
  repo: string | null;
  text: string;
  followUps: string[];
  outcome: Outcome;
}

export type TestRunner = 'vitest' | 'jest' | 'karma' | 'none';

export interface ProjectProfile {
  angularVersion: string | null;
  standalone: boolean;
  signals: boolean;
  zoneless: boolean;
  ssr: boolean;
  controlFlow: boolean;
  testRunner: TestRunner;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  evidence: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  guidance: string;
  check(event: PromptEvent, profile: ProjectProfile): Finding | null;
}
```

`src/core/hash.ts`:
```ts
import { createHash } from 'node:crypto';

export function stableId(...parts: Array<string | number>): string {
  return createHash('sha256').update(parts.map(String).join('\u0000')).digest('hex').slice(0, 16);
}
```

`src/core/index.ts`:
```ts
export * from './types.js';
export { stableId } from './hash.js';
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/hash.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): shared types and stableId"
```

---

### Task 3: File listing and path config

**Files:**
- Create: `src/util/fs.ts`, `src/config/paths.ts`
- Test: `tests/util/fs.test.ts`, `tests/config/paths.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/util/fs.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { listFiles } from '../../src/util/fs.js';

test('listFiles walks recursively, filters, skips node_modules, sorts, limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'ngc-fs-'));
  mkdirSync(join(root, 'a/b'), { recursive: true });
  mkdirSync(join(root, 'node_modules/x'), { recursive: true });
  writeFileSync(join(root, 'a/b/two.jsonl'), '');
  writeFileSync(join(root, 'a/one.jsonl'), '');
  writeFileSync(join(root, 'a/skip.txt'), '');
  writeFileSync(join(root, 'node_modules/x/three.jsonl'), '');

  const all = listFiles(root, (n) => n.endsWith('.jsonl'));
  expect(all).toEqual([join(root, 'a/b/two.jsonl'), join(root, 'a/one.jsonl')]);
  expect(listFiles(root, (n) => n.endsWith('.jsonl'), 1)).toHaveLength(1);
  expect(listFiles(join(root, 'missing'), () => true)).toEqual([]);
});
```

`tests/config/paths.test.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { agentHome, dbPath, ngcoachHome } from '../../src/config/paths.js';

test('paths default to the home directory', () => {
  expect(ngcoachHome({})).toBe(join(homedir(), '.ngcoach'));
  expect(agentHome({})).toBe(homedir());
  expect(dbPath({})).toBe(join(homedir(), '.ngcoach', 'ngcoach.db'));
});

test('paths honour env overrides', () => {
  const env = { NGCOACH_HOME: '/tmp/ngc', NGCOACH_AGENT_HOME: '/tmp/agents' };
  expect(ngcoachHome(env)).toBe('/tmp/ngc');
  expect(agentHome(env)).toBe('/tmp/agents');
  expect(dbPath(env)).toBe('/tmp/ngc/ngcoach.db');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run tests/util tests/config`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/util/fs.ts`:
```ts
import { existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

export function listFiles(dir: string, match: (name: string) => boolean, limit = 10_000): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !match(entry.name)) continue;
    const parent = entry.parentPath;
    if (parent.split(sep).includes('node_modules')) continue;
    out.push(join(parent, entry.name));
  }
  return out.sort().slice(0, limit);
}
```

`src/config/paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export const ngcoachHome = (env: Env = process.env): string =>
  env.NGCOACH_HOME ?? join(homedir(), '.ngcoach');

export const agentHome = (env: Env = process.env): string => env.NGCOACH_AGENT_HOME ?? homedir();

export const dbPath = (env: Env = process.env): string => join(ngcoachHome(env), 'ngcoach.db');
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/util tests/config && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: file listing and path config"
```

---

### Task 4: Text cleaning and event building

**Files:**
- Create: `src/ingest/adapter.ts`, `src/ingest/clean.ts`, `src/ingest/events.ts`
- Test: `tests/ingest/clean.test.ts`, `tests/ingest/events.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/ingest/clean.test.ts`:
```ts
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
```

`tests/ingest/events.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run tests/ingest`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/ingest/adapter.ts`:
```ts
import type { AgentId, RawTurn } from '../core/index.js';

export interface ReadResult {
  turns: RawTurn[];
  /** Records that were present but unparseable or failed schema validation. */
  skipped: number;
}

export interface Adapter {
  id: AgentId;
  /** Absolute paths of log sources under the given home directory. */
  discover(home: string): string[];
  /** Read one source. May throw on unrecoverable format problems. */
  read(source: string): ReadResult;
}
```

`src/ingest/clean.ts`:
```ts
export function cleanText(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

export function isNoise(text: string): boolean {
  return text === '' || text.startsWith('<command-') || text.startsWith('<local-command') || text.startsWith('Caveat:');
}
```

`src/ingest/events.ts`:
```ts
import { stableId, type Outcome, type PromptEvent, type RawTurn } from '../core/index.js';

const CORRECTION =
  /^\s*(no\b|nope\b|don'?t\b|do not\b|instead\b|actually\b|wrong\b|still\b|stop\b|that'?s (not|wrong)|it (didn'?t|doesn'?t|still)|not (what|like)|why did you)|\buse .+ instead\b|\bthat (broke|failed)\b/i;

export function isCorrection(text: string): boolean {
  return CORRECTION.test(text);
}

interface Draft {
  first: RawTurn;
  followUps: string[];
  replied: boolean;
}

export function buildEvents(turns: RawTurn[]): PromptEvent[] {
  const sessions = new Map<string, RawTurn[]>();
  for (const t of turns) {
    const key = `${t.agent}\u0000${t.sessionId}`;
    const list = sessions.get(key) ?? [];
    list.push(t);
    sessions.set(key, list);
  }

  const events: PromptEvent[] = [];
  for (const list of sessions.values()) {
    list.sort((a, b) => a.index - b.index);
    let current: Draft | null = null;
    let repliedSinceUser = false;
    const drafts: Draft[] = [];

    for (const t of list) {
      if (t.role === 'assistant') {
        if (current) current.replied = true;
        repliedSinceUser = true;
        continue;
      }
      if (current && repliedSinceUser && isCorrection(t.text)) {
        current.followUps.push(t.text);
      } else {
        current = { first: t, followUps: [], replied: false };
        drafts.push(current);
      }
      repliedSinceUser = false;
    }

    for (const d of drafts) {
      const outcome: Outcome = d.followUps.length > 0 ? 'retried' : d.replied ? 'accepted' : 'abandoned';
      events.push({
        id: stableId(d.first.agent, d.first.sessionId, d.first.index),
        agent: d.first.agent,
        sessionId: d.first.sessionId,
        timestamp: d.first.timestamp,
        repo: d.first.cwd,
        text: d.first.text,
        followUps: d.followUps,
        outcome,
      });
    }
  }
  return events;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/ingest && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ingest): text cleaning and prompt event building"
```

---

### Task 5: Claude Code adapter

Claude Code writes `~/.claude/projects/<dir>/<session>.jsonl`. User and assistant records carry `sessionId`, `timestamp`, `cwd`, `isSidechain` and `message.content` (string or array of parts). User records that carry a `tool_result` part are tool output, not prompts.

**Files:**
- Create: `src/ingest/claude-code.ts`, `tests/fixtures/agent-home/.claude/projects/-work-shop/session-a.jsonl`
- Test: `tests/ingest/claude-code.test.ts`

- [ ] **Step 1: Create the fixture** (one JSON object per line, exactly as below)

`tests/fixtures/agent-home/.claude/projects/-work-shop/session-a.jsonl`:
```
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:00:00.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"user","content":"Create a product list component using *ngFor <system-reminder>ignore me</system-reminder>"}}
{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-01T10:00:05.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"assistant","content":[{"type":"text","text":"Here is the component."},{"type":"tool_use","id":"t1","name":"Write","input":{}}]}}
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:00:06.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:01:00.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"user","content":[{"type":"text","text":"no, use signals for the list"}]}}
{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-01T10:01:05.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"assistant","content":[{"type":"text","text":"Updated."}]}}
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:02:00.000Z","cwd":"/work/shop","isSidechain":true,"message":{"role":"user","content":"subagent prompt"}}
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:03:00.000Z","cwd":"/work/shop","isSidechain":false,"message":{"role":"user","content":"<command-name>/clear</command-name>"}}
{"type":"file-history-snapshot","messageId":"m1","snapshot":{}}
this is not json
{"type":"user","sessionId":"sess-a","timestamp":"2026-10-01T10:04:00.000Z","cwd":"/work/shop","message":{"role":"user","content":42}}
```

- [ ] **Step 2: Write the failing test**

`tests/ingest/claude-code.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm vitest run tests/ingest/claude-code.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/ingest/claude-code.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { RawTurn } from '../core/index.js';
import type { Adapter, ReadResult } from './adapter.js';
import { cleanText, isNoise } from './clean.js';
import { listFiles } from '../util/fs.js';

const Part = z.object({ type: z.string(), text: z.string().optional() }).passthrough();

const MessageRecord = z.object({
  type: z.enum(['user', 'assistant']),
  sessionId: z.string(),
  timestamp: z.string(),
  cwd: z.string().optional(),
  isSidechain: z.boolean().optional(),
  message: z.object({ content: z.union([z.string(), z.array(Part)]) }),
});

export function readClaudeCode(source: string): ReadResult {
  const turns: RawTurn[] = [];
  let skipped = 0;
  const lines = readFileSync(source, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      return;
    }
    const type = (raw as { type?: unknown } | null)?.type;
    if (type !== 'user' && type !== 'assistant') return;

    const parsed = MessageRecord.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      return;
    }
    const rec = parsed.data;
    if (rec.isSidechain) return;

    const content = rec.message.content;
    if (rec.type === 'user' && Array.isArray(content) && content.some((p) => p.type === 'tool_result')) return;

    const text = cleanText(
      typeof content === 'string'
        ? content
        : content.filter((p) => p.type === 'text' && p.text).map((p) => p.text).join('\n'),
    );
    if (rec.type === 'user' && isNoise(text)) return;

    turns.push({
      agent: 'claude-code',
      sessionId: rec.sessionId,
      index,
      timestamp: rec.timestamp,
      role: rec.type,
      text,
      cwd: rec.cwd ?? null,
    });
  });

  return { turns, skipped };
}

export const claudeCode: Adapter = {
  id: 'claude-code',
  discover: (home) => listFiles(join(home, '.claude', 'projects'), (n) => n.endsWith('.jsonl')),
  read: readClaudeCode,
};
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run tests/ingest/claude-code.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ingest): Claude Code adapter"
```

---

### Task 6: Copilot CLI adapter

Copilot CLI writes `~/.copilot/session-state/<id>/events.jsonl`. Each line is `{type, id, parentId, timestamp, data}`. `session.start` carries `data.sessionId` and `data.context.cwd`. Only `user.message` events with `data.source === 'user'` (or no source) are human prompts; other sources are injected skill or system content.

**Files:**
- Create: `src/ingest/copilot.ts`, `tests/fixtures/agent-home/.copilot/session-state/sess-b/events.jsonl`
- Test: `tests/ingest/copilot.test.ts`

- [ ] **Step 1: Create the fixture**

`tests/fixtures/agent-home/.copilot/session-state/sess-b/events.jsonl`:
```
{"type":"session.start","id":"e0","parentId":null,"timestamp":"2026-10-02T09:00:00.000Z","data":{"sessionId":"sess-b","context":{"cwd":"/work/admin","gitRoot":"/work/admin","branch":"main"}}}
{"type":"user.message","id":"e1","parentId":"e0","timestamp":"2026-10-02T09:00:10.000Z","data":{"content":"Add a login form","source":"user"}}
{"type":"assistant.message","id":"e2","parentId":"e1","timestamp":"2026-10-02T09:00:20.000Z","data":{"content":"Added LoginComponent."}}
{"type":"user.message","id":"e3","parentId":"e2","timestamp":"2026-10-02T09:00:30.000Z","data":{"content":"<skill-context>injected</skill-context>","source":"system"}}
{"type":"user.message","id":"e4","parentId":"e3","timestamp":"2026-10-02T09:00:40.000Z","data":{"content":123,"source":"user"}}
{"type":"tool.execution_start","id":"e5","parentId":"e4","timestamp":"2026-10-02T09:00:50.000Z","data":{}}
```

- [ ] **Step 2: Write the failing test**

`tests/ingest/copilot.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm vitest run tests/ingest/copilot.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/ingest/copilot.ts`:
```ts
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type { RawTurn } from '../core/index.js';
import type { Adapter, ReadResult } from './adapter.js';
import { cleanText, isNoise } from './clean.js';
import { listFiles } from '../util/fs.js';

const Envelope = z.object({ type: z.string(), timestamp: z.string(), data: z.unknown() });
const SessionStart = z.object({
  sessionId: z.string().optional(),
  context: z.object({ cwd: z.string().optional() }).passthrough().optional(),
});
const UserMessage = z.object({ content: z.string(), source: z.string().optional() });
const AssistantMessage = z.object({ content: z.string().default('') });

export function readCopilot(source: string): ReadResult {
  let sessionId = basename(dirname(source));
  let cwd: string | null = null;
  const pending: Array<Omit<RawTurn, 'sessionId' | 'cwd'>> = [];
  let skipped = 0;

  readFileSync(source, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        skipped++;
        return;
      }
      const env = Envelope.safeParse(raw);
      if (!env.success) {
        skipped++;
        return;
      }
      const { type, timestamp, data } = env.data;

      if (type === 'session.start') {
        const s = SessionStart.safeParse(data);
        if (!s.success) {
          skipped++;
          return;
        }
        sessionId = s.data.sessionId ?? sessionId;
        cwd = s.data.context?.cwd ?? cwd;
      } else if (type === 'user.message') {
        const m = UserMessage.safeParse(data);
        if (!m.success) {
          skipped++;
          return;
        }
        if (m.data.source !== undefined && m.data.source !== 'user') return;
        const text = cleanText(m.data.content);
        if (isNoise(text)) return;
        pending.push({ agent: 'copilot', index, timestamp, role: 'user', text });
      } else if (type === 'assistant.message') {
        const m = AssistantMessage.safeParse(data);
        if (!m.success) {
          skipped++;
          return;
        }
        pending.push({ agent: 'copilot', index, timestamp, role: 'assistant', text: cleanText(m.data.content) });
      }
    });

  return { turns: pending.map((t) => ({ ...t, sessionId, cwd })), skipped };
}

export const copilot: Adapter = {
  id: 'copilot',
  discover: (home) => listFiles(join(home, '.copilot', 'session-state'), (n) => n === 'events.jsonl'),
  read: readCopilot,
};
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run tests/ingest/copilot.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ingest): Copilot CLI adapter"
```

---

### Task 7: Cursor adapter and adapter registry

Cursor keeps chats in `<CursorUser>/globalStorage/state.vscdb` (SQLite). `composerHeaders(composerId, workspaceId, isSubagent, …)` lists chats. Messages live in `cursorDiskKV` under keys `bubbleId:<composerId>:<bubbleId>` with JSON values `{type: 1|2, text, createdAt}` (1 = user, 2 = assistant; `createdAt` is an ISO string or epoch milliseconds). `workspaceId` maps to `<CursorUser>/workspaceStorage/<id>/workspace.json` → `{"folder":"file:///path"}`.

`<CursorUser>` is `~/Library/Application Support/Cursor/User` on macOS, `%APPDATA%/Cursor/User` (`~/AppData/Roaming/...`) on Windows, and `~/.config/Cursor/User` on Linux.

**Files:**
- Create: `src/ingest/cursor.ts`, `src/ingest/index.ts`
- Test: `tests/ingest/cursor.test.ts`, `tests/ingest/registry.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/ingest/cursor.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { cursorUserDir, discoverCursor, readCursor } from '../../src/ingest/cursor.js';

function makeCursorHome(platform: NodeJS.Platform) {
  const home = mkdtempSync(join(tmpdir(), 'ngc-cursor-'));
  const user = cursorUserDir(home, platform);
  mkdirSync(join(user, 'globalStorage'), { recursive: true });
  mkdirSync(join(user, 'workspaceStorage', 'ws1'), { recursive: true });
  writeFileSync(
    join(user, 'workspaceStorage', 'ws1', 'workspace.json'),
    JSON.stringify({ folder: pathToFileURL('/work/cursor-app').href }),
  );
  const dbFile = join(user, 'globalStorage', 'state.vscdb');
  const db = new DatabaseSync(dbFile);
  db.exec(`
    create table ItemTable (key text unique on conflict replace, value blob);
    create table cursorDiskKV (key text unique on conflict replace, value blob);
    create table composerHeaders (composerId text primary key, workspaceId text, createdAt integer, isSubagent integer);
  `);
  db.prepare('insert into composerHeaders values (?, ?, ?, ?)').run('c1', 'ws1', 1, 0);
  db.prepare('insert into composerHeaders values (?, ?, ?, ?)').run('c2', 'ws1', 1, 1);
  const put = db.prepare('insert into cursorDiskKV values (?, ?)');
  put.run('bubbleId:c1:b2', JSON.stringify({ type: 2, text: 'Sure.', createdAt: '2026-10-03T08:00:05.000Z' }));
  put.run('bubbleId:c1:b1', JSON.stringify({ type: 1, text: 'Refactor the cart service', createdAt: '2026-10-03T08:00:00.000Z' }));
  put.run('bubbleId:c1:b3', JSON.stringify({ type: 1, text: 'no, keep the API', createdAt: Date.parse('2026-10-03T08:01:00.000Z') }));
  put.run('bubbleId:c1:b4', 'not json');
  put.run('bubbleId:c1:b5', JSON.stringify({ type: 'weird' }));
  put.run('bubbleId:c2:b1', JSON.stringify({ type: 1, text: 'subagent', createdAt: '2026-10-03T08:00:00.000Z' }));
  put.run('composerData:c1', '{}');
  db.close();
  return { home, dbFile };
}

test('cursorUserDir resolves per platform', () => {
  expect(cursorUserDir('/h', 'darwin')).toBe(join('/h', 'Library', 'Application Support', 'Cursor', 'User'));
  expect(cursorUserDir('/h', 'linux')).toBe(join('/h', '.config', 'Cursor', 'User'));
  expect(cursorUserDir('/h', 'win32')).toBe(join('/h', 'AppData', 'Roaming', 'Cursor', 'User'));
});

test('discovers the global db only when present', () => {
  const { home, dbFile } = makeCursorHome('linux');
  expect(discoverCursor(home, 'linux')).toEqual([dbFile]);
  expect(discoverCursor(home, 'darwin')).toEqual([]);
});

test('reads ordered bubbles, maps workspace folder, skips subagents and malformed', () => {
  const { dbFile } = makeCursorHome('linux');
  const { turns, skipped } = readCursor(dbFile);
  expect(skipped).toBe(2);
  expect(turns.map((t) => [t.role, t.text, t.index])).toEqual([
    ['user', 'Refactor the cart service', 0],
    ['assistant', 'Sure.', 1],
    ['user', 'no, keep the API', 2],
  ]);
  expect(turns[0]).toMatchObject({ agent: 'cursor', sessionId: 'c1', cwd: '/work/cursor-app' });
  expect(turns[2]?.timestamp).toBe('2026-10-03T08:01:00.000Z');
});

test('throws on an unexpected schema so doctor can report it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ngc-cursor-bad-'));
  const file = join(dir, 'state.vscdb');
  new DatabaseSync(file).close();
  expect(() => readCursor(file)).toThrow(/unexpected schema/);
});
```

`tests/ingest/registry.test.ts`:
```ts
import { expect, test } from 'vitest';
import { ADAPTERS } from '../../src/ingest/index.js';

test('registry has one adapter per agent', () => {
  expect(ADAPTERS.map((a) => a.id)).toEqual(['claude-code', 'copilot', 'cursor']);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run tests/ingest/cursor.test.ts tests/ingest/registry.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/ingest/cursor.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RawTurn } from '../core/index.js';
import type { Adapter, ReadResult } from './adapter.js';
import { cleanText, isNoise } from './clean.js';

const Bubble = z.object({
  type: z.union([z.literal(1), z.literal(2)]),
  text: z.string().default(''),
  createdAt: z.union([z.string(), z.number()]),
});

export function cursorUserDir(home: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Cursor', 'User');
  if (platform === 'win32') return join(home, 'AppData', 'Roaming', 'Cursor', 'User');
  return join(home, '.config', 'Cursor', 'User');
}

export function discoverCursor(home: string, platform: NodeJS.Platform): string[] {
  const db = join(cursorUserDir(home, platform), 'globalStorage', 'state.vscdb');
  return existsSync(db) ? [db] : [];
}

function workspaceFolder(userDir: string, workspaceId: string | null, cache: Map<string, string | null>): string | null {
  if (!workspaceId) return null;
  if (cache.has(workspaceId)) return cache.get(workspaceId)!;
  let folder: string | null = null;
  try {
    const json = JSON.parse(readFileSync(join(userDir, 'workspaceStorage', workspaceId, 'workspace.json'), 'utf8'));
    if (typeof json.folder === 'string' && json.folder.startsWith('file:')) folder = fileURLToPath(json.folder);
  } catch {
    folder = null;
  }
  cache.set(workspaceId, folder);
  return folder;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('utf8'));

export function readCursor(source: string): ReadResult {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    if (!tables.has('cursorDiskKV') || !tables.has('composerHeaders')) {
      throw new Error('cursor: unexpected schema (missing cursorDiskKV or composerHeaders)');
    }

    const headers = new Map<string, { workspaceId: string | null; isSubagent: boolean }>();
    for (const row of db.prepare('select composerId, workspaceId, isSubagent from composerHeaders').all() as Array<{
      composerId: string;
      workspaceId: string | null;
      isSubagent: number | null;
    }>) {
      headers.set(row.composerId, { workspaceId: row.workspaceId, isSubagent: Boolean(row.isSubagent) });
    }

    const userDir = dirname(dirname(source));
    const folders = new Map<string, string | null>();
    const byComposer = new Map<string, Array<{ bubbleId: string; role: RawTurn['role']; text: string; ts: string }>>();
    let skipped = 0;

    const rows = db.prepare("select key, value from cursorDiskKV where key like 'bubbleId:%'").all() as Array<{
      key: string;
      value: unknown;
    }>;
    for (const row of rows) {
      const [, composerId, bubbleId] = row.key.split(':');
      if (!composerId || !bubbleId) continue;
      if (headers.get(composerId)?.isSubagent) continue;

      let raw: unknown;
      try {
        raw = JSON.parse(asText(row.value));
      } catch {
        skipped++;
        continue;
      }
      const parsed = Bubble.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      const date = new Date(parsed.data.createdAt);
      if (Number.isNaN(date.getTime())) {
        skipped++;
        continue;
      }
      const role = parsed.data.type === 1 ? 'user' : 'assistant';
      const text = cleanText(parsed.data.text);
      if (role === 'user' && isNoise(text)) continue;

      const list = byComposer.get(composerId) ?? [];
      list.push({ bubbleId, role, text, ts: date.toISOString() });
      byComposer.set(composerId, list);
    }

    const turns: RawTurn[] = [];
    for (const [composerId, list] of byComposer) {
      list.sort((a, b) => a.ts.localeCompare(b.ts) || a.bubbleId.localeCompare(b.bubbleId));
      const cwd = workspaceFolder(userDir, headers.get(composerId)?.workspaceId ?? null, folders);
      list.forEach((b, index) =>
        turns.push({ agent: 'cursor', sessionId: composerId, index, timestamp: b.ts, role: b.role, text: b.text, cwd }),
      );
    }
    return { turns, skipped };
  } finally {
    db.close();
  }
}

export const cursor: Adapter = {
  id: 'cursor',
  discover: (home) => discoverCursor(home, process.platform),
  read: readCursor,
};
```

`src/ingest/index.ts`:
```ts
import type { Adapter } from './adapter.js';
import { claudeCode } from './claude-code.js';
import { copilot } from './copilot.js';
import { cursor } from './cursor.js';

export type { Adapter, ReadResult } from './adapter.js';
export { buildEvents, isCorrection } from './events.js';

export const ADAPTERS: Adapter[] = [claudeCode, copilot, cursor];
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/ingest && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ingest): Cursor adapter and adapter registry"
```

---

### Task 8: Project context profile

**Files:**
- Create: `src/context/profile.ts`, `src/context/index.ts`
- Create fixtures: `tests/fixtures/repos/ng20-standalone/{package.json,angular.json,src/app/app.ts,src/app/app.html,src/app/app.config.ts}`, `tests/fixtures/repos/ng16-modules/{package.json,src/app/app.module.ts,src/app/app.component.html}`, `tests/fixtures/repos/not-angular/package.json`
- Test: `tests/context/profile.test.ts`

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/repos/ng20-standalone/package.json`:
```json
{
  "name": "ng20",
  "dependencies": { "@angular/core": "^20.1.0", "@angular/ssr": "^20.1.0" },
  "devDependencies": { "vitest": "^3.2.0" }
}
```

`tests/fixtures/repos/ng20-standalone/angular.json`:
```json
{ "projects": { "app": { "architect": { "build": { "builder": "@angular/build:application" } } } } }
```

`tests/fixtures/repos/ng20-standalone/src/app/app.ts`:
```ts
import { Component, signal } from '@angular/core';

@Component({ selector: 'app-root', templateUrl: './app.html' })
export class App {
  readonly items = signal<string[]>([]);
}
```

`tests/fixtures/repos/ng20-standalone/src/app/app.html`:
```html
@if (items().length) {
  <ul>@for (item of items(); track item) { <li>{{ item }}</li> }</ul>
}
```

`tests/fixtures/repos/ng20-standalone/src/app/app.config.ts`:
```ts
import { provideZonelessChangeDetection } from '@angular/core';

export const appConfig = { providers: [provideZonelessChangeDetection()] };
```

`tests/fixtures/repos/ng16-modules/package.json`:
```json
{
  "name": "ng16",
  "dependencies": { "@angular/core": "~16.2.0", "zone.js": "~0.13.0" },
  "devDependencies": { "karma": "~6.4.0", "jasmine-core": "~4.6.0" }
}
```

`tests/fixtures/repos/ng16-modules/src/app/app.module.ts`:
```ts
import { NgModule } from '@angular/core';
import { AppComponent } from './app.component';

@NgModule({ declarations: [AppComponent], bootstrap: [AppComponent] })
export class AppModule {}
```

`tests/fixtures/repos/ng16-modules/src/app/app.component.html`:
```html
<ul *ngIf="items.length"><li *ngFor="let item of items">{{ item }}</li></ul>
```

`tests/fixtures/repos/not-angular/package.json`:
```json
{ "name": "plain", "dependencies": { "express": "^5.0.0" } }
```

- [ ] **Step 2: Write the failing test**

`tests/context/profile.test.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { buildProfile, EMPTY_PROFILE } from '../../src/context/index.js';

const repo = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));

test('modern standalone/zoneless Angular 20 project', () => {
  expect(buildProfile(repo('ng20-standalone'))).toEqual({
    angularVersion: '20.1.0',
    standalone: true,
    signals: true,
    zoneless: true,
    ssr: true,
    controlFlow: true,
    testRunner: 'vitest',
  });
});

test('NgModule-based Angular 16 project', () => {
  expect(buildProfile(repo('ng16-modules'))).toEqual({
    angularVersion: '16.2.0',
    standalone: false,
    signals: false,
    zoneless: false,
    ssr: false,
    controlFlow: false,
    testRunner: 'karma',
  });
});

test('non-Angular and missing repos get the empty profile', () => {
  expect(buildProfile(repo('not-angular'))).toEqual(EMPTY_PROFILE);
  expect(buildProfile('/definitely/not/here')).toEqual(EMPTY_PROFILE);
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm vitest run tests/context`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/context/profile.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { ProjectProfile, TestRunner } from '../core/index.js';
import { listFiles } from '../util/fs.js';

export const EMPTY_PROFILE: ProjectProfile = Object.freeze({
  angularVersion: null,
  standalone: false,
  signals: false,
  zoneless: false,
  ssr: false,
  controlFlow: false,
  testRunner: 'none',
}) as ProjectProfile;

const SIGNAL_API = /\b(signal|computed|input|model)\s*[<(]/;
const CONTROL_FLOW = /@(if|for|switch)\s*\(/;
const ZONELESS_PROVIDER = /provide(Experimental)?ZonelessChangeDetection/;
const NG_MODULE = /@NgModule\s*\(/;

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function buildProfile(repo: string): ProjectProfile {
  const pkg = readJson(join(repo, 'package.json'));
  if (!pkg) return { ...EMPTY_PROFILE };
  const deps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const core = deps['@angular/core'];
  const angularVersion = core ? (semver.coerce(core)?.version ?? null) : null;
  if (!angularVersion) return { ...EMPTY_PROFILE };

  const angularJson = existsSync(join(repo, 'angular.json')) ? readFileSync(join(repo, 'angular.json'), 'utf8') : '';
  let testRunner: TestRunner = 'none';
  if (deps.vitest || angularJson.includes('@angular/build:unit-test')) testRunner = 'vitest';
  else if (deps.jest) testRunner = 'jest';
  else if (deps.karma) testRunner = 'karma';

  let ngModule = false;
  let signals = false;
  let controlFlow = false;
  let zonelessProvider = false;
  for (const file of listFiles(join(repo, 'src'), (n) => /\.(ts|html)$/.test(n), 2000)) {
    const text = readFileSync(file, 'utf8');
    ngModule ||= NG_MODULE.test(text);
    signals ||= SIGNAL_API.test(text);
    controlFlow ||= CONTROL_FLOW.test(text);
    zonelessProvider ||= ZONELESS_PROVIDER.test(text);
  }

  return {
    angularVersion,
    standalone: !ngModule,
    signals,
    zoneless: zonelessProvider || !deps['zone.js'],
    ssr: Boolean(deps['@angular/ssr'] || deps['@nguniversal/express-engine']),
    controlFlow,
    testRunner,
  };
}
```

> Non-Angular repos get `EMPTY_PROFILE` (including `testRunner: 'none'`), because every rule that reads the test runner also requires Angular.

`src/context/index.ts`:
```ts
export { buildProfile, EMPTY_PROFILE } from './profile.js';
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run tests/context && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(context): Angular project profile"
```

---

### Task 9: Rule engine and generic prompt rules

**Files:**
- Create: `src/rules/pattern-rule.ts`, `src/rules/generic.ts`, `src/rules/index.ts`
- Create: `tests/rules/helpers.ts`
- Test: `tests/rules/pattern-rule.test.ts`, `tests/rules/generic.test.ts`

- [ ] **Step 1: Write the shared test helpers**

`tests/rules/helpers.ts`:
```ts
import { EMPTY_PROFILE } from '../../src/context/index.js';
import type { ProjectProfile, PromptEvent } from '../../src/core/index.js';

export const ANGULAR_20: ProjectProfile = {
  angularVersion: '20.1.0',
  standalone: true,
  signals: true,
  zoneless: true,
  ssr: false,
  controlFlow: true,
  testRunner: 'vitest',
};

export const ANGULAR_16: ProjectProfile = {
  angularVersion: '16.2.0',
  standalone: false,
  signals: false,
  zoneless: false,
  ssr: false,
  controlFlow: false,
  testRunner: 'karma',
};

export const EMPTY = EMPTY_PROFILE;

export function event(text: string, followUps: string[] = []): PromptEvent {
  return {
    id: 'e1',
    agent: 'claude-code',
    sessionId: 's1',
    timestamp: '2026-10-03T08:00:00.000Z',
    repo: '/work/app',
    text,
    followUps,
    outcome: followUps.length ? 'retried' : 'accepted',
  };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/rules/pattern-rule.test.ts`:
```ts
import { expect, test } from 'vitest';
import { patternRule } from '../../src/rules/pattern-rule.js';
import { ANGULAR_16, ANGULAR_20, EMPTY, event } from './helpers.js';

const rule = patternRule({
  id: 'test/ngif',
  severity: 'warn',
  guidance: 'Use @if.',
  angularRange: '>=17',
  match: (text) => text.match(/\*ngIf/)?.[0] ?? null,
  message: (evidence, profile) => `${evidence} on ${profile.angularVersion}`,
});

test('fires with evidence and a dynamic message', () => {
  expect(rule.check(event('use *ngIf here'), ANGULAR_20)).toEqual({
    ruleId: 'test/ngif',
    severity: 'warn',
    message: '*ngIf on 20.1.0',
    evidence: '*ngIf',
  });
});

test('respects the Angular version range and unknown versions', () => {
  expect(rule.check(event('use *ngIf here'), ANGULAR_16)).toBeNull();
  expect(rule.check(event('use *ngIf here'), EMPTY)).toBeNull();
});

test('respects requiresAngular and when()', () => {
  const r = patternRule({
    id: 'test/when',
    severity: 'info',
    guidance: 'g',
    requiresAngular: true,
    when: (p) => p.standalone,
    match: (t) => (t.includes('x') ? 'x' : null),
    message: 'm',
  });
  expect(r.check(event('x'), EMPTY)).toBeNull();
  expect(r.check(event('x'), ANGULAR_16)).toBeNull();
  expect(r.check(event('x'), ANGULAR_20)?.message).toBe('m');
  expect(r.check(event('y'), ANGULAR_20)).toBeNull();
});
```

`tests/rules/generic.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm vitest run tests/rules`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/rules/pattern-rule.ts`:
```ts
import semver from 'semver';
import type { Finding, ProjectProfile, PromptEvent, Rule, Severity } from '../core/index.js';

export interface PatternRuleSpec {
  id: string;
  severity: Severity;
  guidance: string;
  requiresAngular?: boolean;
  angularRange?: string;
  when?: (profile: ProjectProfile) => boolean;
  match: (text: string, event: PromptEvent, profile: ProjectProfile) => string | null;
  message: string | ((evidence: string, profile: ProjectProfile) => string);
}

export function patternRule(spec: PatternRuleSpec): Rule {
  return {
    id: spec.id,
    severity: spec.severity,
    guidance: spec.guidance,
    check(event, profile): Finding | null {
      const version = profile.angularVersion;
      if ((spec.requiresAngular || spec.angularRange) && !version) return null;
      if (spec.angularRange && version && !semver.satisfies(version, spec.angularRange)) return null;
      if (spec.when && !spec.when(profile)) return null;
      const evidence = spec.match(event.text, event, profile);
      if (evidence === null) return null;
      const message = typeof spec.message === 'string' ? spec.message : spec.message(evidence, profile);
      return { ruleId: spec.id, severity: spec.severity, message, evidence };
    },
  };
}
```

`src/rules/generic.ts`:
```ts
import type { Rule } from '../core/index.js';
import { patternRule } from './pattern-rule.js';

const REQUEST_VERB = /\b(add|create|fix|update|change|refactor|implement|build|make)\b/i;
const TARGET = /(`[^`]+`|\b[\w.-]+\/[\w./-]+|\b[\w-]+\.(ts|html|scss|css|json|md)\b|\b[A-Z][a-z0-9]+[A-Z]\w*)/;
const ACCEPTANCE = /\b(should|must|so that|expect|tests?|verify|make sure|ensure|done when)\b/i;

export const GENERIC_RULES: Rule[] = [
  patternRule({
    id: 'gen/vague-request',
    severity: 'warn',
    guidance: 'Say what to change, where, and how you will know it worked. Short prompts force the agent to guess.',
    match: (text) => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      return words.length < 5 ? text.trim() : null;
    },
    message: 'Prompt is very short; the agent has to guess the intent.',
  }),
  patternRule({
    id: 'gen/no-target',
    severity: 'info',
    guidance: 'Name the file, component or symbol to change (e.g. `src/app/cart/cart.ts` or `CartService`).',
    match: (text) => {
      if (text.trim().split(/\s+/).length < 5) return null;
      const verb = text.match(REQUEST_VERB)?.[0];
      return verb && !TARGET.test(text) ? verb : null;
    },
    message: (verb) => `"${verb}" request without a file or symbol to target.`,
  }),
  patternRule({
    id: 'gen/no-acceptance',
    severity: 'info',
    guidance: 'Add a success criterion: "should …", "tests must pass", "done when …".',
    match: (text) => {
      if (text.trim().split(/\s+/).length < 5) return null;
      const verb = text.match(REQUEST_VERB)?.[0];
      return verb && !ACCEPTANCE.test(text) ? verb : null;
    },
    message: 'No acceptance criteria; the agent cannot tell when it is done.',
  }),
  patternRule({
    id: 'gen/repeated-correction',
    severity: 'warn',
    guidance: 'When you correct the agent twice, the first prompt was missing context. Put that context up front next time.',
    match: (_text, event) => (event.followUps.length >= 2 ? event.followUps.join(' | ') : null),
    message: 'You corrected the agent several times after this prompt.',
  }),
];
```

> `gen/no-target` and `gen/no-acceptance` skip prompts under 5 words, which `gen/vague-request` already covers, so one vague prompt yields one finding.

`src/rules/index.ts`:
```ts
import type { Finding, ProjectProfile, PromptEvent, Rule } from '../core/index.js';
import { ANGULAR_RULES } from './angular.js';
import { GENERIC_RULES } from './generic.js';

export { patternRule } from './pattern-rule.js';
export { ANGULAR_RULES, GENERIC_RULES };

export const ALL_RULES: Rule[] = [...GENERIC_RULES, ...ANGULAR_RULES];

export function runRules(event: PromptEvent, profile: ProjectProfile, rules: Rule[] = ALL_RULES): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    const finding = rule.check(event, profile);
    if (finding) out.push(finding);
  }
  return out;
}

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}
```

Create a temporary empty `src/rules/angular.ts` so this task compiles (Task 10 fills it in):
```ts
import type { Rule } from '../core/index.js';

export const ANGULAR_RULES: Rule[] = [];
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/rules && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(rules): rule engine and generic prompt rules"
```

---

### Task 10: Angular rulebook

Rules use the project profile so advice fits the repo. Example: we never nudge an Angular 16 project toward `@if`.

**Files:**
- Modify: `src/rules/angular.ts` (replace the placeholder from Task 9)
- Test: `tests/rules/angular.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/rules/angular.test.ts`:
```ts
import { expect, test } from 'vitest';
import type { ProjectProfile } from '../../src/core/index.js';
import { ANGULAR_RULES } from '../../src/rules/angular.js';
import { runRules } from '../../src/rules/index.js';
import { ANGULAR_16, ANGULAR_20, EMPTY, event } from './helpers.js';

const fired = (text: string, profile: ProjectProfile) =>
  runRules(event(text), profile, ANGULAR_RULES).map((f) => f.ruleId);

test.each<[string, ProjectProfile, string[]]>([
  ['In Angular 20, wrap the list in *ngIf', ANGULAR_20, ['ng/control-flow']],
  ['In Angular 16, wrap the list in *ngIf', ANGULAR_16, []],
  ['Angular 20: register it in app.module', ANGULAR_20, ['ng/standalone']],
  ['Angular 16: register it in app.module', ANGULAR_16, []],
  ['Angular 20: add an @Input() for the title', ANGULAR_20, ['ng/signal-io']],
  ['Angular 20: inject HttpClient via constructor injection', ANGULAR_20, ['ng/inject-fn']],
  ['Angular 20: call detectChanges after the update', ANGULAR_20, ['ng/zoneless']],
  ['Angular 16: call detectChanges after the update', ANGULAR_16, []],
  ['Angular 20: build a login form', ANGULAR_20, ['ng/forms-kind']],
  ['Angular 20: build a reactive login form', ANGULAR_20, []],
  ['Angular 20: write jest tests for it', ANGULAR_20, ['ng/test-runner']],
  ['Angular 20: write vitest tests for it', ANGULAR_20, []],
  ['Angular 16: write jasmine specs for it', ANGULAR_16, []],
  ['create a component for the cart', ANGULAR_20, ['ng/version-unstated']],
  ['create a component for the cart', EMPTY, []],
  ['wrap the list in *ngIf', EMPTY, []],
])('%s', (text, profile, expected) => {
  expect(fired(text, profile)).toEqual(expected);
});

test('messages mention the project version', () => {
  const [finding] = runRules(event('Angular 20: use *ngFor'), ANGULAR_20, ANGULAR_RULES);
  expect(finding?.message).toContain('20.1.0');
  expect(finding?.evidence).toBe('*ngFor');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/rules/angular.test.ts`
Expected: FAIL, nothing fires (`ANGULAR_RULES` is empty).

- [ ] **Step 3: Implement**

`src/rules/angular.ts`:
```ts
import type { Rule, TestRunner } from '../core/index.js';
import { patternRule } from './pattern-rule.js';

const first = (re: RegExp) => (text: string) => text.match(re)?.[0] ?? null;

const RUNNER_WORDS: Record<Exclude<TestRunner, 'none'>, RegExp> = {
  vitest: /\bvitest\b/i,
  jest: /\bjest\b/i,
  karma: /\b(karma|jasmine)\b/i,
};

export const ANGULAR_RULES: Rule[] = [
  patternRule({
    id: 'ng/control-flow',
    severity: 'warn',
    guidance: 'This project supports built-in control flow. Ask for `@if`, `@for (…; track …)` and `@switch` instead of structural directives.',
    angularRange: '>=17',
    match: first(/\*ng(If|For|Switch\w*)\b/),
    message: (ev, p) => `Asked for ${ev}, but Angular ${p.angularVersion} has built-in control flow (@if/@for/@switch).`,
  }),
  patternRule({
    id: 'ng/standalone',
    severity: 'warn',
    guidance: 'This project is standalone. Ask for standalone components with `imports: [...]`, not NgModules.',
    angularRange: '>=15',
    when: (p) => p.standalone,
    match: first(/\b(NgModule|app\.module|declarations)\b/),
    message: (ev, p) => `Mentioned ${ev}, but this Angular ${p.angularVersion} project uses standalone components.`,
  }),
  patternRule({
    id: 'ng/signal-io',
    severity: 'warn',
    guidance: 'Ask for signal-based `input()`, `output()` and `model()` instead of decorators.',
    angularRange: '>=17.1',
    match: first(/@(Input|Output)\b|\bEventEmitter\b/),
    message: (ev, p) => `Asked for ${ev}; Angular ${p.angularVersion} has input()/output()/model().`,
  }),
  patternRule({
    id: 'ng/inject-fn',
    severity: 'info',
    guidance: 'Prefer `inject()` over constructor parameters for dependency injection.',
    angularRange: '>=14',
    match: first(/\bconstructor (injection|parameters?|DI)\b|\binject\w* (it |them )?(via|in|through) (the )?constructor\b/i),
    message: (_ev, p) => `Angular ${p.angularVersion} supports inject(); constructor injection is the older style.`,
  }),
  patternRule({
    id: 'ng/zoneless',
    severity: 'warn',
    guidance: 'This app is zoneless. Ask for signal-driven updates; avoid NgZone, zone.js and manual change detection.',
    angularRange: '>=18',
    when: (p) => p.zoneless,
    match: first(/\b(NgZone|zone\.js|detectChanges|ChangeDetectorRef)\b/),
    message: (ev, p) => `Mentioned ${ev}, but this Angular ${p.angularVersion} app runs without zone.js.`,
  }),
  patternRule({
    id: 'ng/forms-kind',
    severity: 'info',
    guidance: 'Say which forms API you want: reactive (FormGroup), template-driven (ngModel) or signal forms.',
    requiresAngular: true,
    match: (text) => {
      const hit = text.match(/\bforms?\b/i)?.[0];
      if (!hit) return null;
      return /\b(reactive|template[- ]driven|signal forms?|FormGroup|FormControl|ngModel)\b/i.test(text) ? null : hit;
    },
    message: 'Form requested without saying reactive, template-driven or signal forms.',
  }),
  patternRule({
    id: 'ng/test-runner',
    severity: 'warn',
    guidance: 'Ask for tests in the runner this project uses, so the agent does not install a second one.',
    requiresAngular: true,
    when: (p) => p.testRunner !== 'none',
    match: (text, _event, profile) => {
      for (const [runner, re] of Object.entries(RUNNER_WORDS)) {
        if (runner === profile.testRunner) continue;
        const hit = text.match(re)?.[0];
        if (hit) return `${runner}:${hit}`;
      }
      return null;
    },
    message: (ev, p) => `Mentioned ${ev.split(':')[1]}, but this project tests with ${p.testRunner}.`,
  }),
  patternRule({
    id: 'ng/version-unstated',
    severity: 'info',
    guidance: 'Mention the Angular version (or put it in agents.md) so the agent picks the right APIs.',
    requiresAngular: true,
    match: (text) => {
      if (/\b(angular|ng)\s*v?\d{1,2}\b/i.test(text)) return null;
      return text.match(/\b(components?|services?|directives?|pipes?|signals?|routes?|routing|templates?|modules?)\b/i)?.[0] ?? null;
    },
    message: (_ev, p) => `Angular term used without a version; this project is on ${p.angularVersion}.`,
  }),
];
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/rules && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rules): Angular rulebook driven by project profile"
```

---

### Task 11: Local store

**Files:**
- Create: `src/store/db.ts`, `src/store/index.ts`
- Test: `tests/store/db.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/store/db.test.ts`:
```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Finding, PromptEvent } from '../../src/core/index.js';
import { Store } from '../../src/store/index.js';

const ev = (id: string, over: Partial<PromptEvent> = {}): PromptEvent => ({
  id,
  agent: 'claude-code',
  sessionId: 's1',
  timestamp: '2026-10-03T08:00:00.000Z',
  repo: '/work/app',
  text: `prompt ${id}`,
  followUps: [],
  outcome: 'accepted',
  ...over,
});
const finding: Finding = { ruleId: 'gen/vague-request', severity: 'warn', message: 'm', evidence: 'fix it' };

test('creates the parent folder for a file database', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'ngc-store-')), 'nested');
  const store = new Store(join(dir, 'ngcoach.db'));
  store.close();
  expect(existsSync(join(dir, 'ngcoach.db'))).toBe(true);
});

test('saves events with findings and replaces findings on re-save', () => {
  const store = new Store(':memory:');
  store.saveEvent(ev('a', { followUps: ['no'], outcome: 'retried' }), [finding, { ...finding, ruleId: 'gen/no-target' }]);
  store.saveEvent(ev('a', { followUps: ['no'], outcome: 'retried' }), [finding]);
  const [stored] = store.listEvents();
  expect(stored).toMatchObject({ id: 'a', followUps: ['no'], outcome: 'retried' });
  expect(stored?.findings).toEqual([finding]);
});

test('filters by repo, agent and since, newest first', () => {
  const store = new Store(':memory:');
  store.saveEvent(ev('old', { timestamp: '2026-09-01T00:00:00.000Z' }), []);
  store.saveEvent(ev('new', { timestamp: '2026-10-02T00:00:00.000Z' }), []);
  store.saveEvent(ev('other', { repo: '/work/other', agent: 'cursor' }), []);
  expect(store.listEvents().map((e) => e.id)).toEqual(['other', 'new', 'old']);
  expect(store.listEvents({ repo: '/work/app' }).map((e) => e.id)).toEqual(['new', 'old']);
  expect(store.listEvents({ agent: 'cursor' }).map((e) => e.id)).toEqual(['other']);
  expect(store.listEvents({ since: '2026-10-01T00:00:00.000Z' }).map((e) => e.id)).toEqual(['other', 'new']);
});

test('checkpoints, adapter stats and clear', () => {
  const store = new Store(':memory:');
  expect(store.getCheckpoint('/a.jsonl')).toBeNull();
  store.setCheckpoint('/a.jsonl', 'claude-code', 123);
  expect(store.getCheckpoint('/a.jsonl')).toBe(123);

  const stats = { adapter: 'cursor' as const, sources: 1, events: 2, skipped: 3, error: 'boom', scannedAt: '2026-10-03T00:00:00.000Z' };
  store.setAdapterStats(stats);
  store.setAdapterStats({ ...stats, events: 5, error: null });
  expect(store.listAdapterStats()).toEqual([{ ...stats, events: 5, error: null }]);

  store.saveEvent(ev('a'), [finding]);
  store.clear();
  expect(store.listEvents()).toEqual([]);
  expect(store.getCheckpoint('/a.jsonl')).toBeNull();
  expect(store.listAdapterStats()).toEqual([]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/store`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/store/db.ts`:
```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentId, Finding, Outcome, PromptEvent, Severity } from '../core/index.js';

export interface StoredEvent extends PromptEvent {
  findings: Finding[];
}

export interface AdapterStats {
  adapter: AgentId;
  sources: number;
  events: number;
  skipped: number;
  error: string | null;
  scannedAt: string;
}

export interface EventFilter {
  repo?: string;
  agent?: AgentId;
  since?: string;
}

const SCHEMA = `
  create table if not exists events (
    id text primary key,
    agent text not null,
    session_id text not null,
    timestamp text not null,
    repo text,
    text text not null,
    follow_ups text not null,
    outcome text not null
  );
  create table if not exists findings (
    event_id text not null references events(id) on delete cascade,
    rule_id text not null,
    severity text not null,
    message text not null,
    evidence text not null
  );
  create index if not exists findings_event on findings(event_id);
  create table if not exists checkpoints (source text primary key, adapter text not null, mtime_ms real not null);
  create table if not exists adapter_stats (
    adapter text primary key,
    sources integer not null,
    events integer not null,
    skipped integer not null,
    error text,
    scanned_at text not null
  );
`;

interface EventRow {
  id: string;
  agent: AgentId;
  session_id: string;
  timestamp: string;
  repo: string | null;
  text: string;
  follow_ups: string;
  outcome: Outcome;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
  }

  saveEvent(e: PromptEvent, findings: Finding[]): void {
    this.tx(() => {
      this.db
        .prepare(
          `insert into events (id, agent, session_id, timestamp, repo, text, follow_ups, outcome)
           values (?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(id) do update set agent = excluded.agent, session_id = excluded.session_id,
             timestamp = excluded.timestamp, repo = excluded.repo, text = excluded.text,
             follow_ups = excluded.follow_ups, outcome = excluded.outcome`,
        )
        .run(e.id, e.agent, e.sessionId, e.timestamp, e.repo, e.text, JSON.stringify(e.followUps), e.outcome);
      this.db.prepare('delete from findings where event_id = ?').run(e.id);
      const insert = this.db.prepare(
        'insert into findings (event_id, rule_id, severity, message, evidence) values (?, ?, ?, ?, ?)',
      );
      for (const f of findings) insert.run(e.id, f.ruleId, f.severity, f.message, f.evidence);
    });
  }

  listEvents(filter: EventFilter = {}): StoredEvent[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.repo) (where.push('repo = ?'), args.push(filter.repo));
    if (filter.agent) (where.push('agent = ?'), args.push(filter.agent));
    if (filter.since) (where.push('timestamp >= ?'), args.push(filter.since));
    const sql = `select * from events ${where.length ? `where ${where.join(' and ')}` : ''} order by timestamp desc, id`;
    const rows = this.db.prepare(sql).all(...args) as unknown as EventRow[];
    const findingsStmt = this.db.prepare(
      'select rule_id, severity, message, evidence from findings where event_id = ? order by rowid',
    );
    return rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      sessionId: r.session_id,
      timestamp: r.timestamp,
      repo: r.repo,
      text: r.text,
      followUps: JSON.parse(r.follow_ups) as string[],
      outcome: r.outcome,
      findings: (
        findingsStmt.all(r.id) as unknown as Array<{ rule_id: string; severity: Severity; message: string; evidence: string }>
      ).map((f) => ({ ruleId: f.rule_id, severity: f.severity, message: f.message, evidence: f.evidence })),
    }));
  }

  getCheckpoint(source: string): number | null {
    const row = this.db.prepare('select mtime_ms from checkpoints where source = ?').get(source) as
      | { mtime_ms: number }
      | undefined;
    return row ? row.mtime_ms : null;
  }

  setCheckpoint(source: string, adapter: AgentId, mtimeMs: number): void {
    this.db
      .prepare(
        `insert into checkpoints (source, adapter, mtime_ms) values (?, ?, ?)
         on conflict(source) do update set adapter = excluded.adapter, mtime_ms = excluded.mtime_ms`,
      )
      .run(source, adapter, mtimeMs);
  }

  setAdapterStats(s: AdapterStats): void {
    this.db
      .prepare(
        `insert into adapter_stats (adapter, sources, events, skipped, error, scanned_at) values (?, ?, ?, ?, ?, ?)
         on conflict(adapter) do update set sources = excluded.sources, events = excluded.events,
           skipped = excluded.skipped, error = excluded.error, scanned_at = excluded.scanned_at`,
      )
      .run(s.adapter, s.sources, s.events, s.skipped, s.error, s.scannedAt);
  }

  listAdapterStats(): AdapterStats[] {
    const rows = this.db.prepare('select * from adapter_stats order by adapter').all() as unknown as Array<{
      adapter: AgentId;
      sources: number;
      events: number;
      skipped: number;
      error: string | null;
      scanned_at: string;
    }>;
    return rows.map((r) => ({
      adapter: r.adapter,
      sources: r.sources,
      events: r.events,
      skipped: r.skipped,
      error: r.error,
      scannedAt: r.scanned_at,
    }));
  }

  clear(): void {
    this.db.exec('delete from findings; delete from events; delete from checkpoints; delete from adapter_stats;');
  }

  close(): void {
    this.db.close();
  }

  private tx(fn: () => void): void {
    this.db.exec('begin');
    try {
      fn();
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }
}
```

`src/store/index.ts`:
```ts
export { Store } from './db.js';
export type { AdapterStats, EventFilter, StoredEvent } from './db.js';
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run tests/store && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(store): SQLite store for events, findings, checkpoints"
```

---

### Task 12: Scan pipeline

`scan()` ties the pieces together: discover → read changed sources → build events → profile → rules → store. A failure in one source or adapter is recorded and never stops the scan.

**Files:**
- Create: `src/pipeline/scan.ts`
- Test: `tests/pipeline/scan.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/pipeline/scan.test.ts`:
```ts
import { expect, test } from 'vitest';
import type { ProjectProfile, RawTurn } from '../../src/core/index.js';
import type { Adapter } from '../../src/ingest/index.js';
import { scan } from '../../src/pipeline/scan.js';
import { Store } from '../../src/store/index.js';
import { ANGULAR_20 } from '../rules/helpers.js';

const turn = (sessionId: string, index: number, role: RawTurn['role'], text: string): RawTurn => ({
  agent: 'claude-code',
  sessionId,
  index,
  timestamp: `2026-10-03T08:00:0${index}.000Z`,
  role,
  text,
  cwd: '/work/app',
});

function fakeAdapter(reads: Record<string, () => { turns: RawTurn[]; skipped: number }>, calls: string[]): Adapter {
  return {
    id: 'claude-code',
    discover: () => Object.keys(reads),
    read: (source) => {
      calls.push(source);
      return reads[source]!();
    },
  };
}

const NOW = () => new Date('2026-10-03T09:00:00.000Z');

test('ingests events, applies rules with the repo profile and records stats', () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  const profiles: string[] = [];
  const adapter = fakeAdapter(
    {
      '/logs/a.jsonl': () => ({
        turns: [turn('a', 0, 'user', 'Angular 20: wrap the list in *ngIf'), turn('a', 1, 'assistant', 'ok')],
        skipped: 1,
      }),
      '/logs/b.jsonl': () => {
        throw new Error('bad file');
      },
    },
    calls,
  );
  const profile = (repo: string): ProjectProfile => (profiles.push(repo), ANGULAR_20);

  const result = scan({ store, adapters: [adapter], home: '/home', profile, mtime: () => 1, now: NOW });

  expect(result.adapters).toEqual([
    {
      adapter: 'claude-code',
      sources: 2,
      events: 1,
      skipped: 1,
      error: '/logs/b.jsonl: bad file',
      scannedAt: '2026-10-03T09:00:00.000Z',
    },
  ]);
  expect(profiles).toEqual(['/work/app']);
  const [event] = store.listEvents();
  expect(event?.findings.map((f) => f.ruleId)).toEqual(['ng/control-flow']);
  expect(store.listAdapterStats()).toEqual(result.adapters);
});

test('skips unchanged sources, re-reads changed ones, rebuild starts fresh', () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  const adapter = fakeAdapter(
    { '/logs/a.jsonl': () => ({ turns: [turn('a', 0, 'user', 'explain the router setup in this app')], skipped: 0 }) },
    calls,
  );
  let mtime = 1;
  const opts = { store, adapters: [adapter], home: '/home', mtime: () => mtime, now: NOW };

  scan(opts);
  scan(opts);
  expect(calls).toHaveLength(1);

  mtime = 2;
  scan(opts);
  expect(calls).toHaveLength(2);

  scan({ ...opts, rebuild: true });
  expect(calls).toHaveLength(3);
  expect(store.listEvents()).toHaveLength(1);
});

test('an adapter whose discover throws is reported and others still run', () => {
  const store = new Store(':memory:');
  const broken: Adapter = {
    id: 'cursor',
    discover: () => {
      throw new Error('no access');
    },
    read: () => ({ turns: [], skipped: 0 }),
  };
  const ok = fakeAdapter({ '/logs/a.jsonl': () => ({ turns: [turn('a', 0, 'user', 'hello there agent friend')], skipped: 0 }) }, []);

  const result = scan({ store, adapters: [broken, ok], home: '/home', mtime: () => 1, now: NOW });

  expect(result.adapters.map((a) => [a.adapter, a.error, a.events])).toEqual([
    ['cursor', 'discover: no access', 0],
    ['claude-code', null, 1],
  ]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/pipeline`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/pipeline/scan.ts`:
```ts
import { statSync } from 'node:fs';
import { buildProfile, EMPTY_PROFILE } from '../context/index.js';
import type { ProjectProfile } from '../core/index.js';
import { buildEvents, type Adapter } from '../ingest/index.js';
import { runRules } from '../rules/index.js';
import type { AdapterStats, Store } from '../store/index.js';

export interface ScanOptions {
  store: Store;
  adapters: Adapter[];
  home: string;
  rebuild?: boolean;
  profile?: (repo: string) => ProjectProfile;
  mtime?: (source: string) => number;
  now?: () => Date;
}

export interface ScanResult {
  adapters: AdapterStats[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function scan(opts: ScanOptions): ScanResult {
  const { store, adapters, home } = opts;
  const profileOf = opts.profile ?? buildProfile;
  const mtimeOf = opts.mtime ?? ((source: string) => statSync(source).mtimeMs);
  const now = opts.now ?? (() => new Date());

  if (opts.rebuild) store.clear();

  const profiles = new Map<string, ProjectProfile>();
  const profileFor = (repo: string | null): ProjectProfile => {
    if (!repo) return EMPTY_PROFILE;
    let p = profiles.get(repo);
    if (!p) {
      try {
        p = profileOf(repo);
      } catch {
        p = EMPTY_PROFILE;
      }
      profiles.set(repo, p);
    }
    return p;
  };

  const results: AdapterStats[] = [];
  for (const adapter of adapters) {
    const errors: string[] = [];
    let sources: string[] = [];
    let events = 0;
    let skipped = 0;

    try {
      sources = adapter.discover(home);
    } catch (err) {
      errors.push(`discover: ${message(err)}`);
    }

    for (const source of sources) {
      try {
        const mtime = mtimeOf(source);
        if (store.getCheckpoint(source) === mtime) continue;
        const read = adapter.read(source);
        skipped += read.skipped;
        for (const event of buildEvents(read.turns)) {
          store.saveEvent(event, runRules(event, profileFor(event.repo)));
          events++;
        }
        store.setCheckpoint(source, adapter.id, mtime);
      } catch (err) {
        errors.push(`${source}: ${message(err)}`);
      }
    }

    const stats: AdapterStats = {
      adapter: adapter.id,
      sources: sources.length,
      events,
      skipped,
      error: errors.length ? errors.join('; ') : null,
      scannedAt: now().toISOString(),
    };
    store.setAdapterStats(stats);
    results.push(stats);
  }
  return { adapters: results };
}
```

> `events` and `skipped` count what this scan read, so an incremental scan with no changes reports `events: 0`. `doctor` shows the total stored per agent separately (Task 14).

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run tests/pipeline && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): incremental scan with per-source error isolation"
```

---

### Task 13: Scoring and report rendering

**Files:**
- Create: `src/report/score.ts`, `src/report/render.ts`, `src/report/index.ts`
- Test: `tests/report/score.test.ts`, `tests/report/render.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/report/score.test.ts`:
```ts
import { expect, test } from 'vitest';
import type { Finding } from '../../src/core/index.js';
import { rankEvents, weaknessScore } from '../../src/report/index.js';
import type { StoredEvent } from '../../src/store/index.js';

const warn: Finding = { ruleId: 'gen/vague-request', severity: 'warn', message: 'm', evidence: 'e' };
const info: Finding = { ruleId: 'gen/no-target', severity: 'info', message: 'm', evidence: 'e' };

const ev = (id: string, over: Partial<StoredEvent> = {}): StoredEvent => ({
  id,
  agent: 'claude-code',
  sessionId: 's',
  timestamp: '2026-10-03T08:00:00.000Z',
  repo: null,
  text: id,
  followUps: [],
  outcome: 'accepted',
  findings: [],
  ...over,
});

test('weaknessScore weights corrections, warnings and bad outcomes', () => {
  expect(weaknessScore(ev('clean', { findings: [info] }))).toBe(0);
  expect(weaknessScore(ev('warn', { findings: [warn, info] }))).toBe(1);
  expect(weaknessScore(ev('abandoned', { outcome: 'abandoned' }))).toBe(2);
  expect(weaknessScore(ev('retried', { outcome: 'retried', followUps: ['no', 'no'], findings: [warn] }))).toBe(7);
});

test('rankEvents drops zero scores, sorts by score then recency, and limits', () => {
  const events = [
    ev('zero'),
    ev('one-old', { findings: [warn], timestamp: '2026-10-01T00:00:00.000Z' }),
    ev('one-new', { findings: [warn], timestamp: '2026-10-02T00:00:00.000Z' }),
    ev('seven', { outcome: 'retried', followUps: ['a', 'b'], findings: [warn] }),
  ];
  expect(rankEvents(events).map((r) => [r.event.id, r.score])).toEqual([
    ['seven', 7],
    ['one-new', 1],
    ['one-old', 1],
  ]);
  expect(rankEvents(events, 1)).toHaveLength(1);
});
```

`tests/report/render.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run tests/report`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/report/score.ts`:
```ts
import type { StoredEvent } from '../store/index.js';

export interface Ranked {
  event: StoredEvent;
  score: number;
}

export function weaknessScore(e: StoredEvent): number {
  const warns = e.findings.filter((f) => f.severity === 'warn').length;
  return e.followUps.length * 2 + warns + (e.outcome === 'accepted' ? 0 : 2);
}

export function rankEvents(events: StoredEvent[], limit = 10): Ranked[] {
  return events
    .map((event) => ({ event, score: weaknessScore(event) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.event.timestamp.localeCompare(a.event.timestamp))
    .slice(0, limit);
}
```

`src/report/render.ts`:
```ts
import { ruleById } from '../rules/index.js';
import type { Ranked } from './score.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderText(ranked: Ranked[]): string {
  if (ranked.length === 0) {
    return 'No prompts to coach yet. Run `ngcoach scan` to import your agent history, then `ngcoach report`.\n';
  }
  const lines: string[] = [`Top ${ranked.length} prompts to improve`, ''];
  ranked.forEach(({ event: e, score }, i) => {
    lines.push(`${i + 1}. [${e.agent}] ${e.timestamp.slice(0, 10)} ${e.repo ?? '(no repo)'}  score ${score}`);
    for (const line of e.text.split('\n').slice(0, 6)) lines.push(`   > ${line}`);
    if (e.followUps.length) lines.push(`   ${plural(e.followUps.length, 'follow-up correction')}, outcome: ${e.outcome}`);
    for (const f of e.findings) {
      lines.push(`   ${f.severity.padEnd(5)} ${f.ruleId}: ${f.message}`);
      const guidance = ruleById(f.ruleId)?.guidance;
      if (guidance) lines.push(`         → ${guidance}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function renderJson(ranked: Ranked[]): string {
  return JSON.stringify({ prompts: ranked.map(({ event, score }) => ({ ...event, score })) }, null, 2);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderHtml(ranked: Ranked[]): string {
  const cards = ranked
    .map(({ event: e, score }) => {
      const findings = e.findings
        .map((f) => {
          const guidance = ruleById(f.ruleId)?.guidance;
          return `<li class="${esc(f.severity)}"><b>${esc(f.ruleId)}</b> ${esc(f.message)}${
            guidance ? `<div class="g">${esc(guidance)}</div>` : ''
          }</li>`;
        })
        .join('');
      const follow = e.followUps.length
        ? `<p class="meta">${esc(plural(e.followUps.length, 'follow-up correction'))}: ${e.followUps.map(esc).join(' · ')}</p>`
        : '';
      return `<section><p class="meta">${esc(e.agent)} · ${esc(e.timestamp.slice(0, 10))} · ${esc(e.repo ?? '(no repo)')} · score ${score}</p><pre>${esc(e.text)}</pre>${follow}<ol>${findings}</ol></section>`;
    })
    .join('\n');
  const body = cards || '<p>No prompts to coach yet. Run <code>ngcoach scan</code>.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ngcoach report</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1f2328}
section{border:1px solid #d0d7de;border-radius:8px;padding:1rem;margin:1rem 0}
pre{white-space:pre-wrap;background:#f6f8fa;padding:.75rem;border-radius:6px}
.meta{color:#59636e;font-size:13px}.warn b{color:#9a6700}.info b{color:#0969da}.g{color:#59636e}
</style></head><body><h1>ngcoach: prompts to improve</h1>
${body}
</body></html>
`;
}
```

`src/report/index.ts`:
```ts
export { rankEvents, weaknessScore, type Ranked } from './score.js';
export { renderHtml, renderJson, renderText } from './render.js';
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/report && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(report): weakness scoring and text/json/html renderers"
```

---

### Task 14: CLI (`scan`, `report`, `doctor`)

**Files:**
- Create: `src/cli/main.ts`, `src/bin.ts`
- Test: `tests/cli/main.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/cli/main.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/cli`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/cli/main.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { agentHome, dbPath, ngcoachHome } from '../config/paths.js';
import type { AgentId } from '../core/index.js';
import { ADAPTERS } from '../ingest/index.js';
import { scan } from '../pipeline/scan.js';
import { rankEvents, renderHtml, renderJson, renderText } from '../report/index.js';
import { Store } from '../store/index.js';

type Env = Record<string, string | undefined>;
type Write = (s: string) => void;

const USAGE = `Usage: ngcoach <command> [options]

Commands:
  scan [--rebuild]        Import prompts from Claude Code, Copilot CLI and Cursor
  report [options]        Show the prompts most worth improving
    --repo <path>         Only prompts from this repository
    --agent <id>          claude-code | copilot | cursor
    --since <when>        ISO date or relative days, e.g. 7d
    --limit <n>           Number of prompts (default 10)
    --json                Machine-readable output
    --html <file>         Write a self-contained HTML report
  doctor                  Check adapters and local state
  help                    Show this help
`;

const AGENTS: AgentId[] = ['claude-code', 'copilot', 'cursor'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

class UsageError extends Error {}

function parseSince(value: string | undefined, now: Date): string | undefined {
  if (value === undefined) return undefined;
  const days = /^(\d+)d$/.exec(value);
  if (days) return new Date(now.getTime() - Number(days[1]) * 86_400_000).toISOString();
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(date.getTime())) return date.toISOString();
  throw new UsageError(`Invalid --since "${value}". Use an ISO date (2026-10-01) or days (7d).`);
}

function cmdScan(args: string[], write: Write, env: Env): number {
  const { values } = parseArgs({ args, options: { rebuild: { type: 'boolean', default: false } } });
  const store = new Store(dbPath(env));
  try {
    const result = scan({ store, adapters: ADAPTERS, home: agentHome(env), rebuild: values.rebuild });
    for (const a of result.adapters) {
      const line = `${a.adapter.padEnd(12)} ${plural(a.sources, 'source')}  ${plural(a.events, 'event')}  ${a.skipped} skipped`;
      write(`${line}${a.error ? `  error: ${a.error}` : ''}\n`);
    }
    return 0;
  } finally {
    store.close();
  }
}

function cmdReport(args: string[], write: Write, env: Env): number {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      agent: { type: 'string' },
      since: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
      html: { type: 'string' },
    },
  });
  if (values.agent !== undefined && !AGENTS.includes(values.agent as AgentId)) {
    throw new UsageError(`Invalid --agent "${values.agent}". Use one of: ${AGENTS.join(', ')}.`);
  }
  const limit = values.limit === undefined ? 10 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`Invalid --limit "${values.limit}".`);
  const since = parseSince(values.since, new Date());

  const store = new Store(dbPath(env));
  try {
    const events = store.listEvents({ repo: values.repo, agent: values.agent as AgentId | undefined, since });
    const ranked = rankEvents(events, limit);
    if (values.html) {
      writeFileSync(values.html, renderHtml(ranked));
      write(`Wrote ${values.html}\n`);
    } else if (values.json) {
      write(`${renderJson(ranked)}\n`);
    } else {
      write(renderText(ranked));
    }
    return 0;
  } finally {
    store.close();
  }
}

function cmdDoctor(write: Write, env: Env): number {
  let healthy = true;
  write(`state: ${ngcoachHome(env)}\nagent home: ${agentHome(env)}\n\n`);
  const store = new Store(dbPath(env));
  try {
    const stats = new Map(store.listAdapterStats().map((s) => [s.adapter, s]));
    for (const adapter of ADAPTERS) {
      let status: string;
      try {
        status = `ok  ${plural(adapter.discover(agentHome(env)).length, 'source')}`;
      } catch (err) {
        healthy = false;
        status = `error  ${err instanceof Error ? err.message : String(err)}`;
      }
      const stored = store.listEvents({ agent: adapter.id }).length;
      const last = stats.get(adapter.id);
      const lastScan = last ? `last scan ${last.scannedAt}` : 'never scanned';
      write(`${adapter.id.padEnd(12)} ${status}  ${plural(stored, 'stored event')}  ${lastScan}\n`);
      if (last?.error) {
        healthy = false;
        write(`${''.padEnd(12)} last error: ${last.error}\n`);
      }
    }
  } finally {
    store.close();
  }
  return healthy ? 0 : 1;
}

export function main(argv: string[], write: Write = (s) => void process.stdout.write(s), env: Env = process.env): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'scan':
        return cmdScan(rest, write, env);
      case 'report':
        return cmdReport(rest, write, env);
      case 'doctor':
        return cmdDoctor(write, env);
      case 'help':
      case '--help':
      case '-h':
        write(USAGE);
        return 0;
      default:
        write(command ? `Unknown command "${command}".\n\n${USAGE}` : USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      write(`${(err as Error).message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
}
```

`src/bin.ts`:
```ts
#!/usr/bin/env node
import { main } from './cli/main.js';

process.exitCode = main(process.argv.slice(2));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/cli && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-test the built binary**

Run: `pnpm build && node dist/bin.js help && node dist/bin.js doctor`
Expected: usage text, then one `doctor` line per adapter (exit 0 if no adapter errors on this machine).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(cli): scan, report and doctor commands"
```

---

### Task 15: README and full verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

````markdown
# ngcoach

An Angular-aware coach for the prompts you give AI coding agents.

ngcoach reads your local history from **Claude Code**, **GitHub Copilot CLI** and **Cursor**. It finds prompts that led to corrections, retries or vague results. It checks each one against your project (Angular version, standalone, signals, zoneless, test runner) and tells you how to ask better.

Everything stays on your machine. ngcoach never sends prompts anywhere.

## Requirements

Node.js 22.13 or newer (uses the built-in `node:sqlite`).

## Usage

```bash
ngcoach scan              # import new prompts (incremental)
ngcoach report            # top 10 prompts worth improving
ngcoach report --repo . --since 7d
ngcoach report --html report.html
ngcoach doctor            # check which agents were found
```

`ngcoach scan --rebuild` re-imports everything, for example after upgrading ngcoach.

## What it checks

| Rule | Fires when |
|---|---|
| `gen/vague-request` | The prompt is under 5 words |
| `gen/no-target` | A change request names no file or symbol |
| `gen/no-acceptance` | A change request has no success criterion |
| `gen/repeated-correction` | You corrected the agent 2+ times |
| `ng/control-flow` | You ask for `*ngIf`/`*ngFor` on Angular 17+ |
| `ng/standalone` | You mention NgModules in a standalone app |
| `ng/signal-io` | You ask for `@Input`/`@Output` on Angular 17.1+ |
| `ng/inject-fn` | You ask for constructor injection on Angular 14+ |
| `ng/zoneless` | You mention NgZone or `detectChanges` in a zoneless app |
| `ng/forms-kind` | You ask for a form without naming the forms API |
| `ng/test-runner` | You name a different test runner than the project uses |
| `ng/version-unstated` | You use Angular terms without stating a version |

## Where data lives

| Path | Override |
|---|---|
| `~/.ngcoach/ngcoach.db` | `NGCOACH_HOME` |
| Agent logs under `~` | `NGCOACH_AGENT_HOME` |

## Roadmap

- LLM-powered prompt rewrites with a local model or your own API key
- `agents.md` suggestions from recurring prompt patterns
- Team sharing of anonymized summaries via git
````

- [ ] **Step 2: Run the full verification**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all tests PASS, no type errors, `dist/bin.js` built.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: README for the personal coach"
```
