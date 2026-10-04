import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { buildProfile, EMPTY_PROFILE } from '../../src/context/index.js';

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
