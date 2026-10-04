import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { ProjectProfile, TestRunner } from '../core/index.js';
import { listFiles } from '../util/fs.js';

export const EMPTY_PROFILE: ProjectProfile = Object.freeze({
  angularVersion: null,
  standalone: false,
  signals: false,
  zoneless: false,
  ssr: false,
  controlFlow: false,
  testRunner: 'none',
}) as ProjectProfile;

/** Angular is a dependency, but its version cannot be resolved (e.g. `catalog:` with nothing installed). */
export const ANGULAR_VERSION_UNKNOWN = 'unknown';

const SIGNAL_API = /\b(signal|computed|input|model)\s*[<(]/;
const CONTROL_FLOW = /@(if|for|switch)\s*\(/;
const ZONELESS_PROVIDER = /provide(Experimental)?ZonelessChangeDetection/;
const NG_MODULE = /@NgModule\s*\(/;

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function buildProfile(repo: string): ProjectProfile {
  const pkg = readJson(join(repo, 'package.json'));
  if (!pkg) return { ...EMPTY_PROFILE };
  const deps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const core = deps['@angular/core'];
  if (!core) return { ...EMPTY_PROFILE };
  const installed = readJson(join(repo, 'node_modules', '@angular', 'core', 'package.json'))?.version;
  const angularVersion =
    (semver.validRange(core) ? semver.coerce(core)?.version : null) ??
    (typeof installed === 'string' ? semver.valid(semver.coerce(installed)) : null) ??
    ANGULAR_VERSION_UNKNOWN;

  const angularJson = readText(join(repo, 'angular.json'));
  let testRunner: TestRunner = 'none';
  if (deps.vitest || angularJson.includes('@angular/build:unit-test')) testRunner = 'vitest';
  else if (deps.jest) testRunner = 'jest';
  else if (deps.karma) testRunner = 'karma';

  let ngModule = false;
  let signals = false;
  let controlFlow = false;
  let zonelessProvider = false;
  for (const file of listFiles(join(repo, 'src'), (n) => /\.(ts|html)$/.test(n), 2000)) {
    const text = readText(file);
    ngModule ||= NG_MODULE.test(text);
    signals ||= file.endsWith('.ts') && SIGNAL_API.test(text);
    controlFlow ||= CONTROL_FLOW.test(text);
    zonelessProvider ||= ZONELESS_PROVIDER.test(text);
  }

  return {
    angularVersion,
    standalone: !ngModule,
    signals,
    zoneless: zonelessProvider || !deps['zone.js'],
    ssr: Boolean(deps['@angular/ssr'] || deps['@nguniversal/express-engine']),
    controlFlow,
    testRunner,
  };
}
