# Angular Prompt Coach (ngcoach) — Design

Date: 2026-10-03
Status: Approved design, pre-implementation

## 1. Context and scope

The long-term vision is an observability platform for Angular with three independent products:

1. Error capture (Angular SDK + dashboard, Sentry-like)
2. AI fix suggestions for captured errors
3. **Prompt intelligence** — capture prompts developers type into AI coding agents, coach them toward better prompts, and suggest `agents.md` rules from recurring patterns

This spec covers **only sub-project 3**, the highest-priority feature. Error capture and AI fixes get their own specs later. Prompt coaching is deliberately independent of runtime errors.

### Decisions

| Topic | Decision |
|---|---|
| Prompts captured | Prompts developers type into AI coding agents (Claude Code, Copilot, Cursor) while building Angular apps |
| Users | Individuals (private coaching) and teams (shared `agents.md` suggestions), both in v1 |
| LLM execution | Always local or bring-your-own-key (OpenAI, Anthropic, Ollama). No hosted service, including for teams |
| Team sharing | Through git: anonymized pattern summaries committed to the repo, never raw prompts |
| Angular specificity | Project-aware context (version, patterns in use) plus a curated, versioned rulebook |
| Delivery | CLI first. MCP server and VS Code extension are later thin layers over the same core |

### Out of scope for v1

MCP server, VS Code extension, runtime error capture, AI error fixes, any hosted or self-hosted server, cross-repo org analytics.

## 2. Architecture

TypeScript pnpm monorepo, Node 22+. Each package has one responsibility and a typed public interface.

| Package | Responsibility | Depends on |
|---|---|---|
| `@ngcoach/core` | Shared types: `PromptEvent`, `ProjectProfile`, `Finding`, `PatternSummary` | — |
| `@ngcoach/ingest` | One adapter per agent. Discovers log locations and parses them into `PromptEvent`s incrementally | core |
| `@ngcoach/context` | Reads `package.json`, `angular.json`, `tsconfig.json` and produces a `ProjectProfile` | core |
| `@ngcoach/rules` | Versioned Angular rulebook. Rule checks are deterministic and never call an LLM | core |
| `@ngcoach/llm` | Optional BYOK provider layer for rewrites, embeddings and cluster summaries | core |
| `@ngcoach/analyze` | Prompt scoring and local intent clustering | core, rules, llm |
| `@ngcoach/share` | Redaction, writing and merging pattern summaries, generating the `agents.md` diff | core, analyze |
| `ngcoach` (CLI) | Commands `scan`, `report`, `share`, `suggest`, `doctor` | all |

Local storage: SQLite at `~/.ngcoach/ngcoach.db`, holding events, findings, adapter checkpoints and clusters. Config: `~/.ngcoach/config.json` (provider, model, API key reference via environment variable name, never the key itself).

### Core types

```ts
type AgentId = 'claude-code' | 'copilot' | 'cursor';

interface PromptEvent {
  id: string;               // stable hash of agent + session + turn
  agent: AgentId;
  sessionId: string;
  timestamp: string;        // ISO 8601
  repoPath: string | null;
  text: string;
  followUps: string[];      // subsequent user corrections in the same session
  outcome: 'accepted' | 'retried' | 'abandoned' | 'unknown';
}

interface ProjectProfile {
  angularVersion: string | null;   // semver from @angular/core
  standalone: boolean;
  signals: boolean;
  zoneless: boolean;
  ssr: boolean;
  controlFlow: boolean;            // @if/@for in templates
  testRunner: 'karma' | 'jest' | 'vitest' | 'none' | 'unknown';
}

interface Rule {
  id: string;                      // e.g. "ng/control-flow-over-structural"
  angularRange: string;            // semver range where the rule applies
  appliesTo(profile: ProjectProfile): boolean;
  detect(event: PromptEvent, profile: ProjectProfile): Finding[];
  guidance: string;                // what a better prompt / agents.md line includes
}

interface Finding {
  ruleId: string;
  severity: 'info' | 'warn';
  message: string;
  evidence: string;                // snippet of the prompt or follow-up
}

interface PatternSummary {
  hash: string;                    // stable id of the intent cluster
  intent: string;                  // anonymized description, e.g. "create form with validation"
  frequency: number;
  contributors: number;            // always 1 in an individual file, summed on merge
  commonCorrections: string[];     // anonymized, e.g. "use reactive forms with signals"
  ruleIds: string[];
  angularVersion: string | null;   // major version only
  generatedAt: string;
}
```

## 3. Data flow

### `ngcoach scan`
1. Discover agent logs automatically:
   - Claude Code: `~/.claude/projects/**/*.jsonl`
   - Copilot: `~/.copilot/session-state/**`
   - Cursor: workspace storage SQLite (`state.vscdb`)
2. Each adapter reads only records after its stored checkpoint.
3. Parse into `PromptEvent`s. A user turn following an assistant turn in the same session that corrects or redirects it goes into `followUps` of the originating prompt.
4. Resolve `repoPath` from session metadata (cwd). Build or reuse the cached `ProjectProfile` for that repo.
5. Run all applicable rules. Store events and findings in SQLite.

### `ngcoach report`
1. Rank prompts by weakness score: `followUps.length * 2 + warn findings + (outcome === 'retried' || 'abandoned' ? 2 : 0)`.
2. For each top prompt show the issues found, rule guidance, and, if an LLM is configured, an improved rewrite with a short reason.
3. Output: terminal (default), `--html` writes a self-contained local dashboard file, `--json` for scripting.
4. Filters: `--repo`, `--agent`, `--since`.

### `ngcoach share` (run inside a repo)
1. Group the repo's prompts into intent clusters with embeddings (local Ollama or BYOK). Without an embedding provider, fall back to grouping by matched rule ids.
2. Produce one `PatternSummary` per cluster with frequency ≥ 2.
3. Redact (see §4). Show a full preview and require confirmation (`--yes` to skip).
4. Write `.ngcoach/patterns/<developer-hash>.json`, where `developer-hash` is a salted hash of the git user email so files don't reveal identity. The developer commits this file.

### `ngcoach suggest` (run inside a repo)
1. Merge all `.ngcoach/patterns/*.json` by cluster hash. Clusters are matched across developers by hash first, then by intent similarity when an LLM is available.
2. A cluster becomes a proposed `agents.md` rule when `contributors ≥ 2` or `frequency ≥ 5` (configurable in `.ngcoach/config.json`).
3. Generate concise `agents.md` lines from `commonCorrections` and rule guidance (LLM-written when available, template-based otherwise). Skip rules already present in `agents.md`.
4. Output a unified diff by default. `--write` applies it, `--pr` creates a branch and opens a PR through `gh`.

Core heuristic: **corrections that keep coming back mean a rule is missing from `agents.md`.**

## 4. Privacy and redaction

- Raw prompts and follow-ups never leave the machine and are never written into the repo.
- LLM calls send prompt text only to the provider the user configured.
- Before writing pattern summaries, redaction removes: API keys and tokens (entropy and known formats), emails, absolute file paths, URLs with credentials, personal names from git config, and code blocks.
- **Fail closed:** if the post-redaction scan still detects a secret pattern, that summary is dropped and reported, not written.

## 5. Error handling

| Failure | Behavior |
|---|---|
| Agent log format changes | Each record is checked against a schema per adapter. Records that don't match are skipped and counted. `ngcoach doctor` shows the status of each adapter. A failing adapter never stops other adapters |
| No LLM configured or provider error | Rulebook findings only. Report states that rewrites are unavailable. `share` falls back to rule-id grouping |
| Repo not Angular or not found | Generic prompt rules still apply. Angular rules are skipped |
| Corrupt SQLite or checkpoint | `ngcoach scan --rebuild` re-reads all logs from scratch |
| Redaction detects residual secret | Summary dropped, warning printed |

## 6. Initial rulebook (v1 seed)

Covers at least: control flow (`@if`/`@for` over structural directives on v17+), standalone components over NgModules, signals and `input()`/`output()`/`model()` functions, `inject()` over constructor DI, zoneless change detection awareness, reactive vs template forms, `OnPush`, typed forms, SSR/hydration considerations, test runner match, plus generic prompt-quality rules (missing file/component reference, missing acceptance criteria, missing Angular version context, vague verbs such as "fix it").

Each rule ships with a table-driven test.

## 7. Testing

- **Adapters:** saved sample logs per agent and version, snapshot-tested against expected `PromptEvent`s.
- **Context:** sample `package.json`/`angular.json` sets for v15 through current, checked against expected `ProjectProfile`.
- **Rules:** table of prompt × profile → expected findings (Vitest).
- **Redaction:** suite of known secrets, emails, paths, code and names, all of which must be removed. Fail-closed behavior is tested.
- **Analyze/LLM:** a fake provider for repeatable unit tests, plus a small evaluation set (prompt → rewrite scored by rubric) run manually against real providers.
- **End to end:** a sample Angular repo plus fake logs for two simulated developers, running `scan → share → suggest`, checking the expected `agents.md` diff.

## 8. Future sub-projects (separate specs)

1. MCP server exposing `review_prompt` and `get_project_rules` over the same core
2. VS Code extension: sidebar report and inline prompt coaching
3. Angular error capture SDK and dashboard
4. AI fix suggestions for captured errors
