import semver from 'semver';
import type { Finding, ProjectProfile, PromptEvent, Rule, Severity } from '../core/index.js';

export interface PatternRuleSpec {
  id: string;
  severity: Severity;
  guidance: string;
  requiresAngular?: boolean;
  angularRange?: string;
  when?: (profile: ProjectProfile) => boolean;
  match: (text: string, event: PromptEvent, profile: ProjectProfile) => string | null;
  message: string | ((evidence: string, profile: ProjectProfile) => string);
}

export function patternRule(spec: PatternRuleSpec): Rule {
  return {
    id: spec.id,
    severity: spec.severity,
    guidance: spec.guidance,
    check(event, profile): Finding | null {
      const version = profile.angularVersion;
      if ((spec.requiresAngular || spec.angularRange) && !version) return null;
      if (spec.angularRange && version && !semver.satisfies(version, spec.angularRange)) return null;
      if (spec.when && !spec.when(profile)) return null;
      const evidence = spec.match(event.text, event, profile);
      if (evidence === null) return null;
      const message = typeof spec.message === 'string' ? spec.message : spec.message(evidence, profile);
      return { ruleId: spec.id, severity: spec.severity, message, evidence };
    },
  };
}
