import type { ProjectProfile, PromptEvent, Rule, TestRunner } from '../core/index.js';
import { patternRule } from './pattern-rule.js';

type Match = (text: string, event: PromptEvent, profile: ProjectProfile) => string | null;

const first = (re: RegExp) => (text: string) => text.match(re)?.[0] ?? null;

const MIGRATION_INTENT = /\b(migrat\w*|convert\w*|replac\w*|remov\w*|refactor\w*|upgrad\w*)\b|\binstead of\b/i;

/** True when the prompt asks to move away from an API, so naming the legacy API is the point, not a mistake. */
export const isMigration = (text: string): boolean => MIGRATION_INTENT.test(text);

const unlessMigrating =
  (match: Match): Match =>
  (text, event, profile) =>
    isMigration(text) ? null : match(text, event, profile);

/** NgModule-specific wording; a bare "declarations" (e.g. "type declarations") is not enough. */
const NG_MODULE =
  /\bng-?modules?\b|\b[\w-]+\.module(\.ts)?\b|\bdeclarations\s*(:|\[|array\b)|\b(in|to|into|from)\s+(the\s+)?declarations\b(?!\.)/i;

const RUNNER_WORDS: Record<Exclude<TestRunner, 'none'>, RegExp> = {
  vitest: /\bvitest\b/i,
  jest: /\bjest\b/i,
  karma: /\b(karma|jasmine)\b/i,
};

export const ANGULAR_RULES: Rule[] = [
  patternRule({
    id: 'ng/control-flow',
    severity: 'warn',
    guidance: 'This project supports built-in control flow. Ask for `@if`, `@for (…; track …)` and `@switch` instead of structural directives.',
    angularRange: '>=17',
    when: (p) => p.controlFlow,
    match: unlessMigrating(first(/\*ng(If|For|Switch\w*)\b/)),
    message: (ev, p) => `Asked for ${ev}, but Angular ${p.angularVersion} has built-in control flow (@if/@for/@switch).`,
  }),
  patternRule({
    id: 'ng/standalone',
    severity: 'warn',
    guidance: 'This project is standalone. Ask for standalone components with `imports: [...]`, not NgModules.',
    angularRange: '>=15',
    when: (p) => p.standalone,
    match: first(NG_MODULE),
    message: (ev, p) => `Mentioned ${ev}, but this Angular ${p.angularVersion} project uses standalone components.`,
  }),
  patternRule({
    id: 'ng/signal-io',
    severity: 'warn',
    guidance: 'Ask for signal-based `input()`, `output()` and `model()` instead of decorators.',
    angularRange: '>=17.1',
    when: (p) => p.signals,
    match: unlessMigrating(first(/@(Input|Output)\b|\bEventEmitter\b/)),
    message: (ev, p) => `Asked for ${ev}; Angular ${p.angularVersion} has input()/output()/model().`,
  }),
  patternRule({
    id: 'ng/inject-fn',
    severity: 'info',
    guidance: 'Prefer `inject()` over constructor parameters for dependency injection.',
    angularRange: '>=14',
    match: unlessMigrating(first(/\bconstructor (injection|parameters?|DI)\b|\binject\w* (it |them )?(via|in|through) (the )?constructor\b/i)),
    message: (_ev, p) => `Angular ${p.angularVersion} supports inject(); constructor injection is the older style.`,
  }),
  patternRule({
    id: 'ng/zoneless',
    severity: 'warn',
    guidance: 'This app is zoneless. Ask for signal-driven updates; avoid NgZone, zone.js and manual change detection.',
    angularRange: '>=18',
    when: (p) => p.zoneless,
    match: unlessMigrating(first(/\b(NgZone|zone\.js|detectChanges|ChangeDetectorRef)\b/)),
    message: (ev, p) => `Mentioned ${ev}, but this Angular ${p.angularVersion} app runs without zone.js.`,
  }),
  patternRule({
    id: 'ng/forms-kind',
    severity: 'info',
    guidance: 'Say which forms API you want: reactive (FormGroup), template-driven (ngModel) or signal forms.',
    requiresAngular: true,
    match: (text) => {
      const hit = text.replace(/\bin (the )?forms? of\b/gi, '').match(/\bforms?\b/i)?.[0];
      if (!hit) return null;
      return /\b(reactive|template[- ]driven|signal forms?|FormGroup|FormControl|ngModel)\b/i.test(text) ? null : hit;
    },
    message: 'Form requested without saying reactive, template-driven or signal forms.',
  }),
  patternRule({
    id: 'ng/test-runner',
    severity: 'warn',
    guidance: 'Ask for tests in the runner this project uses, so the agent does not install a second one.',
    requiresAngular: true,
    when: (p) => p.testRunner !== 'none',
    match: unlessMigrating((text, _event, profile) => {
      for (const [runner, re] of Object.entries(RUNNER_WORDS)) {
        if (runner === profile.testRunner) continue;
        const hit = text.match(re)?.[0];
        if (hit) return `${runner}:${hit}`;
      }
      return null;
    }),
    message: (ev, p) => `Mentioned ${ev.split(':')[1]}, but this project tests with ${p.testRunner}.`,
  }),
  patternRule({
    id: 'ng/version-unstated',
    severity: 'info',
    guidance: 'Mention the Angular version (or put it in agents.md) so the agent picks the right APIs.',
    requiresAngular: true,
    match: (text) => {
      if (/\b(angular|ng)\s*v?\d{1,2}\b/i.test(text)) return null;
      return text.match(/\b(components?|services?|directives?|pipes?|signals?|routes?|routing|templates?|modules?)\b/i)?.[0] ?? null;
    },
    message: (_ev, p) =>
      p.angularVersion === 'unknown'
        ? 'Angular term used without a version; the project version could not be resolved.'
        : `Angular term used without a version; this project is on ${p.angularVersion}.`,
  }),
];
