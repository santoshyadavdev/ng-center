import type { AgentId, RawTurn } from '../core/index.js';

export interface ReadResult {
  turns: RawTurn[];
  /** Records that were present but unparseable or failed schema validation. */
  skipped: number;
}

export interface Adapter {
  id: AgentId;
  /** Absolute paths of log sources under the given home directory. */
  discover(home: string): string[];
  /** Read one source. May throw on unrecoverable format problems. */
  read(source: string): ReadResult;
}
