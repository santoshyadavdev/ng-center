import { expect, test } from 'vitest';
import { stableId } from '../../src/core/index.js';

test('stableId is deterministic, 16 hex chars, and part-sensitive', () => {
  const a = stableId('claude-code', 's1', 0);
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(stableId('claude-code', 's1', 0)).toBe(a);
  expect(stableId('claude-code', 's1', 1)).not.toBe(a);
  expect(stableId('claude-code', 's', '10')).not.toBe(stableId('claude-code', 's1', '0'));
});
