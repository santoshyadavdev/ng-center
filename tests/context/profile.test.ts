import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { ANGULAR_VERSION_UNKNOWN, buildProfile, EMPTY_PROFILE } from '../../src/context/index.js';

const repo = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));

test('modern standalone/zoneless Angular 20 project', () => {
  expect(buildProfile(repo('ng20-standalone'))).toEqual({
    angularVersion: '20.1.0',
    standalone: true,
    signals: true,
    zoneless: true,
    ssr: true,
    controlFlow: true,
    testRunner: 'vitest',
  });
});

test('NgModule-based Angular 16 project', () => {
  expect(buildProfile(repo('ng16-modules'))).toEqual({
    angularVersion: '16.2.0',
    standalone: false,
    signals: false,
    zoneless: false,
    ssr: false,
    controlFlow: false,
    testRunner: 'karma',
  });
});

test('non-Angular and missing repos get the empty profile', () => {
  expect(buildProfile(repo('not-angular'))).toEqual(EMPTY_PROFILE);
  expect(buildProfile('/definitely/not/here')).toEqual(EMPTY_PROFILE);
});

function tmpRepo(coreSpec: string, installed?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ngc-profile-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': coreSpec } }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'main.ts'), "import { signal } from '@angular/core';\nconst n = signal(0);\n");
  if (installed) {
    const core = join(dir, 'node_modules', '@angular', 'core');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@angular/core', version: installed }));
  }
  return dir;
}

test.each(['catalog:', 'workspace:*', 'latest', 'next'])('non-semver spec %s falls back to the installed version', (spec) => {
  expect(buildProfile(tmpRepo(spec, '20.0.3'))).toMatchObject({ angularVersion: '20.0.3', signals: true });
});

test('non-semver spec without node_modules still records Angular with an unknown version', () => {
  expect(buildProfile(tmpRepo('catalog:'))).toEqual({
    ...EMPTY_PROFILE,
    angularVersion: ANGULAR_VERSION_UNKNOWN,
    standalone: true,
    signals: true,
    zoneless: true,
  });
});

test('signal detection ignores HTML templates such as <input (keyup)=…>', () => {
  expect(buildProfile(repo('ng16-modules')).signals).toBe(false);
});
