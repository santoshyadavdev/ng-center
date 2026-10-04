import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

test('node:sqlite is available', () => {
  const db = new DatabaseSync(':memory:');
  expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 });
});
