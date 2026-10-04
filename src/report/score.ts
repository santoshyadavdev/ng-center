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
