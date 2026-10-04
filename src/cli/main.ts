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
