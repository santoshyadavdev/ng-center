import { stableId, type Outcome, type PromptEvent, type RawTurn } from '../core/index.js';

const CORRECTION =
  /^\s*(no\b|nope\b|don['’]?t\b|do not\b|instead\b|actually\b|wrong\b|still\b|stop\b|that['’]?s (not|wrong)|it (didn['’]?t|doesn['’]?t|still)|not (what|like)|why did you)|\buse .+ instead\b|\bthat (broke|failed)\b/i;

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
        id: stableId(d.first.agent, d.first.sessionId, d.first.key ?? d.first.index),
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
