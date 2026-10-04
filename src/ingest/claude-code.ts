import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { RawTurn } from '../core/index.js';
import type { Adapter, ReadResult } from './adapter.js';
import { cleanText, isNoise } from './clean.js';
import { listFiles } from '../util/fs.js';

const Part = z.object({ type: z.string(), text: z.string().optional() }).passthrough();

const MessageRecord = z.object({
  type: z.enum(['user', 'assistant']),
  sessionId: z.string(),
  timestamp: z.string(),
  cwd: z.string().optional(),
  isSidechain: z.boolean().optional(),
  message: z.object({ content: z.union([z.string(), z.array(Part)]) }),
});

export function readClaudeCode(source: string): ReadResult {
  const turns: RawTurn[] = [];
  let skipped = 0;
  const lines = readFileSync(source, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      return;
    }
    const type = (raw as { type?: unknown } | null)?.type;
    if (type !== 'user' && type !== 'assistant') return;

    const parsed = MessageRecord.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      return;
    }
    const rec = parsed.data;
    if (rec.isSidechain) return;

    const content = rec.message.content;
    if (rec.type === 'user' && Array.isArray(content) && content.some((p) => p.type === 'tool_result')) return;

    const text = cleanText(
      typeof content === 'string'
        ? content
        : content.filter((p) => p.type === 'text' && p.text).map((p) => p.text).join('\n'),
    );
    if (rec.type === 'user' && isNoise(text)) return;

    turns.push({
      agent: 'claude-code',
      sessionId: rec.sessionId,
      index,
      timestamp: rec.timestamp,
      role: rec.type,
      text,
      cwd: rec.cwd ?? null,
    });
  });

  return { turns, skipped };
}

export const claudeCode: Adapter = {
  id: 'claude-code',
  discover: (home) => listFiles(join(home, '.claude', 'projects'), (n) => n.endsWith('.jsonl')),
  read: readClaudeCode,
};
