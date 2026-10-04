import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

function isAngularRoot(dir: string): boolean {
  if (existsSync(join(dir, 'angular.json'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return Boolean(pkg?.dependencies?.['@angular/core'] ?? pkg?.devDependencies?.['@angular/core']);
  } catch {
    return false;
  }
}

/**
 * Resolve the project root for a working directory, so sessions started in `src/app` or Nx `apps/web`
 * are attributed to the workspace that owns them.
 *
 * Walk up from `cwd`, never inspecting the home dir or the filesystem root:
 * 1. The first directory with a `package.json` that is also Angular (`angular.json`, or `@angular/core`
 *    in dependencies/devDependencies) wins, but only while we have not yet passed a directory that
 *    contains `.git` (the repo boundary; the `.git` directory itself is still considered).
 * 2. Otherwise the nearest directory with a `package.json` wins.
 * 3. Otherwise `cwd` is returned unchanged.
 */
export function projectRoot(cwd: string, home: string = homedir()): string {
  const stop = resolve(home);
  let nearest: string | null = null;
  let insideRepo = true;
  for (let dir = resolve(cwd); dir !== stop && dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      nearest ??= dir;
      if (insideRepo && isAngularRoot(dir)) return dir;
    }
    if (existsSync(join(dir, '.git'))) insideRepo = false;
    if (!insideRepo && nearest) break;
  }
  return nearest ?? cwd;
}
