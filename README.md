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
