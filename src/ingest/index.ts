import type { Adapter } from './adapter.js';
import { claudeCode } from './claude-code.js';
import { copilot } from './copilot.js';
import { cursor } from './cursor.js';

export type { Adapter, ReadResult } from './adapter.js';
export { buildEvents, isCorrection } from './events.js';

export const ADAPTERS: Adapter[] = [claudeCode, copilot, cursor];
