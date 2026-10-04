import { expect, test } from 'vitest';
import { ADAPTERS } from '../../src/ingest/index.js';

test('registry has one adapter per agent', () => {
  expect(ADAPTERS.map((a) => a.id)).toEqual(['claude-code', 'copilot', 'cursor']);
});
