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
  let resumeCwd: string | null = null;
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
      } else if (type === 'session.resume') {
        const r = SessionStart.safeParse(data);
        if (!r.success) {
          skipped++;
          return;
        }
        resumeCwd ??= r.data.context?.cwd ?? null;
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

  const sessionCwd = cwd ?? resumeCwd;
  return { turns: pending.map((t) => ({ ...t, sessionId, cwd: sessionCwd })), skipped };
}

export const copilot: Adapter = {
  id: 'copilot',
  discover: (home) => listFiles(join(home, '.copilot', 'session-state'), (n) => n === 'events.jsonl'),
  read: readCopilot,
};
