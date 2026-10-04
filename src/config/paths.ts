import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export const ngcoachHome = (env: Env = process.env): string =>
  env.NGCOACH_HOME ?? join(homedir(), '.ngcoach');

export const agentHome = (env: Env = process.env): string => env.NGCOACH_AGENT_HOME ?? homedir();

export const dbPath = (env: Env = process.env): string => join(ngcoachHome(env), 'ngcoach.db');
