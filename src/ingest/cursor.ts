import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RawTurn } from '../core/index.js';
import type { Adapter, ReadResult } from './adapter.js';
import { cleanText, isNoise } from './clean.js';

const Bubble = z.object({
  type: z.union([z.literal(1), z.literal(2)]),
  text: z.string().default(''),
  createdAt: z.union([z.string(), z.number()]),
});

export function cursorUserDir(home: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Cursor', 'User');
  if (platform === 'win32') return join(home, 'AppData', 'Roaming', 'Cursor', 'User');
  return join(home, '.config', 'Cursor', 'User');
}

export function discoverCursor(home: string, platform: NodeJS.Platform): string[] {
  const db = join(cursorUserDir(home, platform), 'globalStorage', 'state.vscdb');
  return existsSync(db) ? [db] : [];
}

function workspaceFolder(userDir: string, workspaceId: string | null, cache: Map<string, string | null>): string | null {
  if (!workspaceId) return null;
  if (cache.has(workspaceId)) return cache.get(workspaceId)!;
  let folder: string | null = null;
  try {
    const json = JSON.parse(readFileSync(join(userDir, 'workspaceStorage', workspaceId, 'workspace.json'), 'utf8'));
    if (typeof json.folder === 'string' && json.folder.startsWith('file:')) folder = fileURLToPath(json.folder);
  } catch {
    folder = null;
  }
  cache.set(workspaceId, folder);
  return folder;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('utf8'));

export function readCursor(source: string): ReadResult {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    if (!tables.has('cursorDiskKV') || !tables.has('composerHeaders')) {
      throw new Error('cursor: unexpected schema (missing cursorDiskKV or composerHeaders)');
    }

    const headers = new Map<string, { workspaceId: string | null; isSubagent: boolean }>();
    for (const row of db.prepare('select composerId, workspaceId, isSubagent from composerHeaders').all() as Array<{
      composerId: string;
      workspaceId: string | null;
      isSubagent: number | null;
    }>) {
      headers.set(row.composerId, { workspaceId: row.workspaceId, isSubagent: Boolean(row.isSubagent) });
    }

    const userDir = dirname(dirname(source));
    const folders = new Map<string, string | null>();
    const byComposer = new Map<string, Array<{ bubbleId: string; role: RawTurn['role']; text: string; ts: string }>>();
    let skipped = 0;

    const rows = db.prepare("select key, value from cursorDiskKV where key like 'bubbleId:%'").all() as Array<{
      key: string;
      value: unknown;
    }>;
    for (const row of rows) {
      const [, composerId, bubbleId] = row.key.split(':');
      if (!composerId || !bubbleId) continue;
      if (headers.get(composerId)?.isSubagent) continue;
      if (row.value === null || row.value === undefined) {
        skipped++;
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(asText(row.value));
      } catch {
        skipped++;
        continue;
      }
      const parsed = Bubble.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      const date = new Date(parsed.data.createdAt);
      if (Number.isNaN(date.getTime())) {
        skipped++;
        continue;
      }
      const role = parsed.data.type === 1 ? 'user' : 'assistant';
      const text = cleanText(parsed.data.text);
      if (role === 'user' && isNoise(text)) continue;

      const list = byComposer.get(composerId) ?? [];
      list.push({ bubbleId, role, text, ts: date.toISOString() });
      byComposer.set(composerId, list);
    }

    const turns: RawTurn[] = [];
    for (const [composerId, list] of byComposer) {
      list.sort((a, b) => a.ts.localeCompare(b.ts) || a.bubbleId.localeCompare(b.bubbleId));
      const cwd = workspaceFolder(userDir, headers.get(composerId)?.workspaceId ?? null, folders);
      list.forEach((b, index) =>
        turns.push({ agent: 'cursor', sessionId: composerId, index, timestamp: b.ts, role: b.role, text: b.text, cwd }),
      );
    }
    return { turns, skipped };
  } finally {
    db.close();
  }
}

export const cursor: Adapter = {
  id: 'cursor',
  discover: (home) => discoverCursor(home, process.platform),
  read: readCursor,
};
