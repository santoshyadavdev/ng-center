import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { listFiles } from '../../src/util/fs.js';

test('listFiles walks recursively, filters, skips node_modules, sorts, limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'ngc-fs-'));
  mkdirSync(join(root, 'a/b'), { recursive: true });
  mkdirSync(join(root, 'node_modules/x'), { recursive: true });
  writeFileSync(join(root, 'a/b/two.jsonl'), '');
  writeFileSync(join(root, 'a/one.jsonl'), '');
  writeFileSync(join(root, 'a/skip.txt'), '');
  writeFileSync(join(root, 'node_modules/x/three.jsonl'), '');

  const all = listFiles(root, (n) => n.endsWith('.jsonl'));
  expect(all).toEqual([join(root, 'a/b/two.jsonl'), join(root, 'a/one.jsonl')]);
  expect(listFiles(root, (n) => n.endsWith('.jsonl'), 1)).toHaveLength(1);
  expect(listFiles(join(root, 'missing'), () => true)).toEqual([]);
});
