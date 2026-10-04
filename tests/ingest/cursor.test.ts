import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { cursorUserDir, discoverCursor, readCursor } from '../../src/ingest/cursor.js';

function makeCursorHome(platform: NodeJS.Platform) {
  const home = mkdtempSync(join(tmpdir(), 'ngc-cursor-'));
  const user = cursorUserDir(home, platform);
  mkdirSync(join(user, 'globalStorage'), { recursive: true });
  mkdirSync(join(user, 'workspaceStorage', 'ws1'), { recursive: true });
  writeFileSync(
    join(user, 'workspaceStorage', 'ws1', 'workspace.json'),
    JSON.stringify({ folder: pathToFileURL('/work/cursor-app').href }),
  );
  const dbFile = join(user, 'globalStorage', 'state.vscdb');
  const db = new DatabaseSync(dbFile);
  db.exec(`
    create table ItemTable (key text unique on conflict replace, value blob);
    create table cursorDiskKV (key text unique on conflict replace, value blob);
    create table composerHeaders (composerId text primary key, workspaceId text, createdAt integer, isSubagent integer);
  `);
  db.prepare('insert into composerHeaders values (?, ?, ?, ?)').run('c1', 'ws1', 1, 0);
  db.prepare('insert into composerHeaders values (?, ?, ?, ?)').run('c2', 'ws1', 1, 1);
  const put = db.prepare('insert into cursorDiskKV values (?, ?)');
  put.run('bubbleId:c1:b2', JSON.stringify({ type: 2, text: 'Sure.', createdAt: '2026-10-03T08:00:05.000Z' }));
  put.run('bubbleId:c1:b1', JSON.stringify({ type: 1, text: 'Refactor the cart service', createdAt: '2026-10-03T08:00:00.000Z' }));
  put.run('bubbleId:c1:b3', JSON.stringify({ type: 1, text: 'no, keep the API', createdAt: Date.parse('2026-10-03T08:01:00.000Z') }));
  put.run('bubbleId:c1:b4', 'not json');
  put.run('bubbleId:c1:b5', JSON.stringify({ type: 'weird' }));
  put.run('bubbleId:c2:b1', JSON.stringify({ type: 1, text: 'subagent', createdAt: '2026-10-03T08:00:00.000Z' }));
  put.run('composerData:c1', '{}');
  db.close();
  return { home, dbFile };
}

test('cursorUserDir resolves per platform', () => {
  expect(cursorUserDir('/h', 'darwin')).toBe(join('/h', 'Library', 'Application Support', 'Cursor', 'User'));
  expect(cursorUserDir('/h', 'linux')).toBe(join('/h', '.config', 'Cursor', 'User'));
  expect(cursorUserDir('/h', 'win32')).toBe(join('/h', 'AppData', 'Roaming', 'Cursor', 'User'));
});

test('discovers the global db only when present', () => {
  const { home, dbFile } = makeCursorHome('linux');
  expect(discoverCursor(home, 'linux')).toEqual([dbFile]);
  expect(discoverCursor(home, 'darwin')).toEqual([]);
});

test('reads ordered bubbles, maps workspace folder, skips subagents and malformed', () => {
  const { dbFile } = makeCursorHome('linux');
  const { turns, skipped } = readCursor(dbFile);
  expect(skipped).toBe(2);
  expect(turns.map((t) => [t.role, t.text, t.index])).toEqual([
    ['user', 'Refactor the cart service', 0],
    ['assistant', 'Sure.', 1],
    ['user', 'no, keep the API', 2],
  ]);
  expect(turns[0]).toMatchObject({ agent: 'cursor', sessionId: 'c1', cwd: '/work/cursor-app' });
  expect(turns[2]?.timestamp).toBe('2026-10-03T08:01:00.000Z');
});

test('throws on an unexpected schema so doctor can report it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ngc-cursor-bad-'));
  const file = join(dir, 'state.vscdb');
  new DatabaseSync(file).close();
  expect(() => readCursor(file)).toThrow(/unexpected schema/);
});
