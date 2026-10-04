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

export interface SourceEntry {
  event: PromptEvent;
  findings: Finding[];
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
    outcome text not null,
    source text
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
    const columns = this.db.prepare('pragma table_info(events)').all() as unknown as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'source')) this.db.exec('alter table events add column source text;');
    this.db.exec('create index if not exists events_source on events(source);');
  }

  saveEvent(e: PromptEvent, findings: Finding[], source: string | null = null): void {
    this.tx(() => this.insertEvent(e, findings, source));
  }

  /** Replace everything previously stored for `source` (events and their findings) with `entries`. */
  replaceSource(source: string, entries: SourceEntry[]): void {
    this.tx(() => {
      this.db.prepare('delete from events where source = ?').run(source);
      for (const { event, findings } of entries) this.insertEvent(event, findings, source);
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

  private insertEvent(e: PromptEvent, findings: Finding[], source: string | null): void {
    this.db
      .prepare(
        `insert into events (id, agent, session_id, timestamp, repo, text, follow_ups, outcome, source)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set agent = excluded.agent, session_id = excluded.session_id,
           timestamp = excluded.timestamp, repo = excluded.repo, text = excluded.text,
           follow_ups = excluded.follow_ups, outcome = excluded.outcome, source = excluded.source`,
      )
      .run(e.id, e.agent, e.sessionId, e.timestamp, e.repo, e.text, JSON.stringify(e.followUps), e.outcome, source);
    this.db.prepare('delete from findings where event_id = ?').run(e.id);
    const insert = this.db.prepare(
      'insert into findings (event_id, rule_id, severity, message, evidence) values (?, ?, ?, ?, ?)',
    );
    for (const f of findings) insert.run(e.id, f.ruleId, f.severity, f.message, f.evidence);
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
