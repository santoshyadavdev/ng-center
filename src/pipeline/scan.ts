import { existsSync, statSync } from 'node:fs';
import { buildProfile, EMPTY_PROFILE, projectRoot } from '../context/index.js';
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
  /** Maps an event's working directory to the project root stored as its `repo`. */
  root?: (cwd: string) => string;
  mtime?: (source: string) => number;
  now?: () => Date;
}

export interface ScanResult {
  adapters: AdapterStats[];
}

/** Change time of a source, including an SQLite `-wal` sibling whose writes are not yet checkpointed. */
export function sourceMtime(source: string): number {
  const main = statSync(source).mtimeMs;
  const wal = `${source}-wal`;
  return existsSync(wal) ? Math.max(main, statSync(wal).mtimeMs) : main;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function scan(opts: ScanOptions): ScanResult {
  const { store, adapters, home } = opts;
  const profileOf = opts.profile ?? buildProfile;
  const rootOf = opts.root ?? ((cwd: string) => projectRoot(cwd));
  const mtimeOf = opts.mtime ?? sourceMtime;
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

  const roots = new Map<string, string>();
  const rootFor = (cwd: string | null): string | null => {
    if (!cwd) return cwd;
    let r = roots.get(cwd);
    if (r === undefined) {
      try {
        r = rootOf(cwd);
      } catch {
        r = cwd;
      }
      roots.set(cwd, r);
    }
    return r;
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
        const entries = buildEvents(read.turns).map((built) => {
          const event = { ...built, repo: rootFor(built.repo) };
          return { event, findings: runRules(event, profileFor(event.repo)) };
        });
        store.replaceSource(source, entries);
        store.setCheckpoint(source, adapter.id, mtime);
        events += entries.length;
        skipped += read.skipped;
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
    try {
      store.setAdapterStats(stats);
    } catch (err) {
      const failure = `stats: ${message(err)}`;
      stats.error = stats.error ? `${stats.error}; ${failure}` : failure;
    }
    results.push(stats);
  }
  return { adapters: results };
}
