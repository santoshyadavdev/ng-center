import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { agentHome, dbPath, ngcoachHome } from '../../src/config/paths.js';

test('paths default to the home directory', () => {
  expect(ngcoachHome({})).toBe(join(homedir(), '.ngcoach'));
  expect(agentHome({})).toBe(homedir());
  expect(dbPath({})).toBe(join(homedir(), '.ngcoach', 'ngcoach.db'));
});

test('paths honour env overrides', () => {
  const env = { NGCOACH_HOME: '/tmp/ngc', NGCOACH_AGENT_HOME: '/tmp/agents' };
  expect(ngcoachHome(env)).toBe('/tmp/ngc');
  expect(agentHome(env)).toBe('/tmp/agents');
  expect(dbPath(env)).toBe(join('/tmp/ngc', 'ngcoach.db'));
});
