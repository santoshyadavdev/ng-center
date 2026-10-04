import type { Finding, ProjectProfile, PromptEvent, Rule } from '../core/index.js';
import { ANGULAR_RULES } from './angular.js';
import { GENERIC_RULES } from './generic.js';

export { patternRule } from './pattern-rule.js';
export { ANGULAR_RULES, GENERIC_RULES };

export const ALL_RULES: Rule[] = [...GENERIC_RULES, ...ANGULAR_RULES];

export function runRules(event: PromptEvent, profile: ProjectProfile, rules: Rule[] = ALL_RULES): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    const finding = rule.check(event, profile);
    if (finding) out.push(finding);
  }
  return out;
}

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}
