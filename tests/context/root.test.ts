import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { projectRoot } from '../../src/context/index.js';

const ng20 = fileURLToPath(new URL('../fixtures/repos/ng20-standalone', import.meta.url));

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ngc-root-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    if (path.endsWith('/')) mkdirSync(join(root, path), { recursive: true });
    else writeFileSync(join(root, path), content);
  }
  return root;
}
const angularPkg = JSON.stringify({ dependencies: { '@angular/core': '^20.0.0' } });
const plainPkg = JSON.stringify({ name: 'plain' });

test('a subdirectory of a fixture resolves to the folder with package.json', () => {
  expect(projectRoot(join(ng20, 'src', 'app'))).toBe(ng20);
  expect(projectRoot(ng20)).toBe(ng20);
  expect(projectRoot(`${ng20}/src/`)).toBe(ng20);
});

test('prefers an Angular ancestor over a nearer plain package.json (Nx apps/web)', () => {
  const root = tree({
    '.git/': '',
    'package.json': angularPkg,
    'apps/web/package.json': plainPkg,
    'apps/web/src/app/': '',
  });
  expect(projectRoot(join(root, 'apps/web/src/app'))).toBe(root);
});

test('angular.json marks an Angular root even without @angular/core in package.json', () => {
  const root = tree({ 'package.json': plainPkg, 'angular.json': '{}', 'libs/ui/package.json': plainPkg, 'libs/ui/src/': '' });
  expect(projectRoot(join(root, 'libs/ui/src'))).toBe(root);
});

test('falls back to the nearest package.json when no Angular ancestor exists', () => {
  const root = tree({ 'package.json': plainPkg, 'pkg/package.json': plainPkg, 'pkg/src/': '' });
  expect(projectRoot(join(root, 'pkg/src'))).toBe(join(root, 'pkg'));
});

test('does not prefer an Angular ancestor beyond a .git boundary', () => {
  const root = tree({ 'package.json': angularPkg, 'tool/.git/': '', 'tool/package.json': plainPkg, 'tool/src/': '' });
  expect(projectRoot(join(root, 'tool/src'))).toBe(join(root, 'tool'));
});

test('stops at the home dir and keeps the original cwd when no package.json is found', () => {
  const home = tree({ 'package.json': angularPkg, 'notes/deep/': '' });
  expect(projectRoot(join(home, 'notes/deep'), home)).toBe(join(home, 'notes/deep'));
  expect(projectRoot('/definitely/not/here', '/definitely')).toBe('/definitely/not/here');
});
