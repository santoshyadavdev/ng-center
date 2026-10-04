# ngcoach

An Angular-aware coach for the prompts you give AI coding agents.

ngcoach reads your local history from **Claude Code**, **GitHub Copilot CLI** and **Cursor**. It finds prompts that led to corrections, retries or vague results. It checks each one against your project (Angular version, standalone, signals, zoneless, test runner) and tells you how to ask better.

Everything stays on your machine. ngcoach never sends prompts anywhere.

## Requirements

Node.js 22.13 or newer (uses the built-in `node:sqlite`).

## Install

ngcoach is not published to npm yet. Build it from a clone:

```bash
pnpm install && pnpm build && pnpm link --global   # puts `ngcoach` on your PATH
```

Or skip the link and run `node dist/bin.js <command>` from the clone.

## Usage

```bash
ngcoach scan              # import new prompts (incremental)
ngcoach report            # top 10 prompts worth improving
ngcoach report --repo . --since 7d
ngcoach report --html report.html
ngcoach doctor            # check which agents were found
```

`ngcoach scan --rebuild` re-imports everything, for example after upgrading ngcoach.

### `report` options

| Option | Meaning |
|---|---|
| `--repo <path>` | Only prompts from this project. Accepts `.`, relative paths and subdirectories (see below) |
| `--agent <id>` | Only prompts from `claude-code`, `copilot` or `cursor` |
| `--since <when>` | Only prompts on or after an ISO date (`2026-10-01`) or within the last N days (`7d`) |
| `--limit <n>` | How many prompts to show (default 10) |
| `--json` | Print machine-readable JSON instead of text |
| `--html <file>` | Write a self-contained HTML report to `<file>` |

`--json` and `--html` cannot be combined. If your filters match nothing, `report` says "No prompts matched the filters."

### How repos are resolved

Each prompt is stored under the project root of the directory the agent ran in, not the raw working directory. So a session started in `src/app` or an Nx `apps/web` folder still counts for the workspace. ngcoach walks up from that directory, stopping before your home dir and the filesystem root:

1. The first folder with a `package.json` that is also an Angular project (`angular.json`, or `@angular/core` in its dependencies) wins, as long as the walk has not gone past a folder containing `.git`.
2. Otherwise the nearest folder with a `package.json` wins.
3. Otherwise the original directory is kept.

`--repo` resolves its argument the same way, so `ngcoach report --repo .` works from the project root or any subdirectory. Data scanned by an older ngcoach still uses raw directories; run `ngcoach scan --rebuild` once to re-attribute it.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | `scan`: at least one adapter reported an error (the summary is still printed). `doctor`: a problem was found. Any command: an I/O error such as an unwritable `--html` path, shown as `ngcoach: <message>` |
| `2` | Invalid usage, such as an unknown command or bad option |

## What gets skipped

Noise is dropped at import: empty turns, slash-command output, injected system notifications, interruptions and terminal escape sequences. Long pastes that start with an H1 title (`# Something`) and are over 1500 characters are treated as skill or prompt templates, not your own prompts, and are skipped.

## What it checks

| Rule | Fires when |
|---|---|
| `gen/vague-request` | The prompt is under 5 words (short replies like "yes", "continue" or "option 2" are exempt) |
| `gen/no-target` | A change request names no file or symbol |
| `gen/no-acceptance` | A change request has no success criterion |
| `gen/repeated-correction` | You corrected the agent 2+ times |
| `ng/control-flow` | You ask for `*ngIf`/`*ngFor` on Angular 17+ in a repo that already uses `@if`/`@for` |
| `ng/standalone` | You mention NgModules (`NgModule`, `*.module.ts`, `declarations: [...]`) in a standalone app |
| `ng/signal-io` | You ask for `@Input`/`@Output`/`EventEmitter` on Angular 17.1+ in a repo that already uses signals |
| `ng/inject-fn` | You ask for constructor injection on Angular 14+ |
| `ng/zoneless` | You mention NgZone or `detectChanges` in a zoneless app |
| `ng/forms-kind` | You ask for a form without naming the forms API |
| `ng/test-runner` | You name a different test runner than the project uses |
| `ng/version-unstated` | You use Angular terms without stating a version |

Prompts that ask to migrate away from a legacy API ("migrate", "convert", "replace", "remove", "refactor", "upgrade", "instead of") are not flagged by `ng/control-flow`, `ng/signal-io`, `ng/inject-fn`, `ng/zoneless` or `ng/test-runner`, since naming the old API is the point.

## Where data lives

| Path | Override |
|---|---|
| `~/.ngcoach/ngcoach.db` | `NGCOACH_HOME` |
| Agent logs under `~` | `NGCOACH_AGENT_HOME` |

## Roadmap

- LLM-powered prompt rewrites with a local model or your own API key
- `agents.md` suggestions from recurring prompt patterns
- Team sharing of anonymized summaries via git
