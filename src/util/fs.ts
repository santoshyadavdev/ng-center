import { existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

export function listFiles(dir: string, match: (name: string) => boolean, limit = 10_000): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !match(entry.name)) continue;
    const parent = entry.parentPath;
    if (parent.split(sep).includes('node_modules')) continue;
    out.push(join(parent, entry.name));
  }
  return out.sort().slice(0, limit);
}
