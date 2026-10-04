import { EMPTY_PROFILE } from '../../src/context/index.js';
import type { ProjectProfile, PromptEvent } from '../../src/core/index.js';

export const ANGULAR_20: ProjectProfile = {
  angularVersion: '20.1.0',
  standalone: true,
  signals: true,
  zoneless: true,
  ssr: false,
  controlFlow: true,
  testRunner: 'vitest',
};

export const ANGULAR_16: ProjectProfile = {
  angularVersion: '16.2.0',
  standalone: false,
  signals: false,
  zoneless: false,
  ssr: false,
  controlFlow: false,
  testRunner: 'karma',
};

export const EMPTY = EMPTY_PROFILE;

export function event(text: string, followUps: string[] = []): PromptEvent {
  return {
    id: 'e1',
    agent: 'claude-code',
    sessionId: 's1',
    timestamp: '2026-10-03T08:00:00.000Z',
    repo: '/work/app',
    text,
    followUps,
    outcome: followUps.length ? 'retried' : 'accepted',
  };
}
