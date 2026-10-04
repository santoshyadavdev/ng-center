import { expect, test } from 'vitest';
import type { ProjectProfile } from '../../src/core/index.js';
import { ANGULAR_RULES } from '../../src/rules/angular.js';
import { runRules } from '../../src/rules/index.js';
import { ANGULAR_16, ANGULAR_20, EMPTY, event } from './helpers.js';

const fired = (text: string, profile: ProjectProfile) =>
  runRules(event(text), profile, ANGULAR_RULES).map((f) => f.ruleId);

test.each<[string, ProjectProfile, string[]]>([
  ['In Angular 20, wrap the list in *ngIf', ANGULAR_20, ['ng/control-flow']],
  ['In Angular 16, wrap the list in *ngIf', ANGULAR_16, []],
  ['Angular 20: register it in app.module', ANGULAR_20, ['ng/standalone']],
  ['Angular 16: register it in app.module', ANGULAR_16, []],
  ['Angular 20: add an @Input() for the title', ANGULAR_20, ['ng/signal-io']],
  ['Angular 20: inject HttpClient via constructor injection', ANGULAR_20, ['ng/inject-fn']],
  ['Angular 20: call detectChanges after the update', ANGULAR_20, ['ng/zoneless']],
  ['Angular 16: call detectChanges after the update', ANGULAR_16, []],
  ['Angular 20: build a login form', ANGULAR_20, ['ng/forms-kind']],
  ['Angular 20: build a reactive login form', ANGULAR_20, []],
  ['Angular 20: write jest tests for it', ANGULAR_20, ['ng/test-runner']],
  ['Angular 20: write vitest tests for it', ANGULAR_20, []],
  ['Angular 16: write jasmine specs for it', ANGULAR_16, []],
  ['create a component for the cart', ANGULAR_20, ['ng/version-unstated']],
  ['create a component for the cart', EMPTY, []],
  ['wrap the list in *ngIf', EMPTY, []],
])('%s', (text, profile, expected) => {
  expect(fired(text, profile)).toEqual(expected);
});

test('messages mention the project version', () => {
  const [finding] = runRules(event('Angular 20: use *ngFor'), ANGULAR_20, ANGULAR_RULES);
  expect(finding?.message).toContain('20.1.0');
  expect(finding?.evidence).toBe('*ngFor');
});

test.each<[string, string]>([
  ['migrate every *ngIf to @if', 'ng/control-flow'],
  ['replace constructor injection with inject()', 'ng/inject-fn'],
  ['remove NgZone usage', 'ng/zoneless'],
  ['convert @Input() to input()', 'ng/signal-io'],
  ['migrate the specs from jest to vitest', 'ng/test-runner'],
  ['use @if instead of *ngIf everywhere', 'ng/control-flow'],
  ['refactoring: drop EventEmitter for output()', 'ng/signal-io'],
])('migration intent suppresses the legacy-API rule: %s', (text, ruleId) => {
  expect(fired(text, ANGULAR_20)).not.toContain(ruleId);
});

test('migration words need word boundaries', () => {
  expect(fired('Angular 20: the unremovable banner needs *ngIf', ANGULAR_20)).toContain('ng/control-flow');
});
