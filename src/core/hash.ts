import { createHash } from 'node:crypto';

export function stableId(...parts: Array<string | number>): string {
  return createHash('sha256').update(parts.map(String).join('\u0000')).digest('hex').slice(0, 16);
}
