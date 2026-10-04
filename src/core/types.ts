export type AgentId = 'claude-code' | 'copilot' | 'cursor';
export type Outcome = 'accepted' | 'retried' | 'abandoned';
export type Severity = 'info' | 'warn';

export interface RawTurn {
  agent: AgentId;
  sessionId: string;
  index: number;
  timestamp: string;
  role: 'user' | 'assistant';
  text: string;
  cwd: string | null;
  /** Source-native turn id (e.g. Cursor bubbleId); used for event identity instead of `index` when set. */
  key?: string;
}

export interface PromptEvent {
  id: string;
  agent: AgentId;
  sessionId: string;
  timestamp: string;
  repo: string | null;
  text: string;
  followUps: string[];
  outcome: Outcome;
}

export type TestRunner = 'vitest' | 'jest' | 'karma' | 'none';

export interface ProjectProfile {
  /** Semver string; 'unknown' if Angular is a dependency but its version cannot be resolved; null if not Angular. */
  angularVersion: string | null;
  standalone: boolean;
  signals: boolean;
  zoneless: boolean;
  ssr: boolean;
  controlFlow: boolean;
  testRunner: TestRunner;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  evidence: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  guidance: string;
  check(event: PromptEvent, profile: ProjectProfile): Finding | null;
}
