import { existsSync, statSync } from 'node:fs';
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
        const entries = buildEvents(read.turns).map((event) => ({
          event,
          findings: runRules(event, profileFor(event.repo)),
        }));
        store.replaceSource(source, entries);
        events += entries.length;
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
