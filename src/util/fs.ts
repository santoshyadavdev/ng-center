import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(dir: string, match: (name: string) => boolean, limit = 10_000): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= limit) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (entry.isFile() && match(entry.name)) {
        out.push(path);
      }
    }
  };
  walk(dir);
  return out.sort();
}
