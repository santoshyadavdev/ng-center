import type { Rule } from '../core/index.js';
import { patternRule } from './pattern-rule.js';

const REQUEST_VERB = /\b(add|create|fix|update|change|refactor|implement|build|make)\b/i;
const TARGET = /(`[^`]+`|\b[\w.-]+\/[\w./-]+|\b[\w-]+\.(ts|html|scss|css|json|md)\b|\b[A-Z][a-z0-9]+[A-Z]\w*)/;
const ACCEPTANCE = /\b(should|must|so that|expect|tests?|verify|make sure|ensure|done when)\b/i;

const AFFIRMATION =
  /^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|k|please|sounds good|looks good|lgtm|thanks?|thank you|ty|go ahead|go for it|continue|proceed|do it|perfect|great|nice|cool|correct|right|exactly|agreed|approved?)[\s,.!?]*)+$/i;
const CHECK_IN = /^(?:(?:are )?you (?:still )?there|still there|hello|hi|any updates?|status)[\s?.!]*$/i;
const OPTION_CHOICE = /^(?:option\s+)?(?:[a-z]|\d{1,2})[).:]?$/i;

/**
 * PromptEvent has no turn position, so in-conversation replies are recognised by shape:
 * affirmations, check-ins, option picks and two-word replies without a request verb.
 */
export function isConversationalReply(text: string): boolean {
  const t = text.trim();
  if (AFFIRMATION.test(t) || CHECK_IN.test(t) || OPTION_CHOICE.test(t)) return true;
  return t.split(/\s+/).length <= 2 && !REQUEST_VERB.test(t);
}

export const GENERIC_RULES: Rule[] = [
  patternRule({
    id: 'gen/vague-request',
    severity: 'warn',
    guidance: 'Say what to change, where, and how you will know it worked. Short prompts force the agent to guess.',
    match: (text) => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      return words.length < 5 && !isConversationalReply(text) ? text.trim() : null;
    },
    message: 'Prompt is very short; the agent has to guess the intent.',
  }),
  patternRule({
    id: 'gen/no-target',
    severity: 'info',
    guidance: 'Name the file, component or symbol to change (e.g. `src/app/cart/cart.ts` or `CartService`).',
    match: (text) => {
      if (text.trim().split(/\s+/).length < 5) return null;
      const verb = text.match(REQUEST_VERB)?.[0];
      return verb && !TARGET.test(text) ? verb : null;
    },
    message: (verb) => `"${verb}" request without a file or symbol to target.`,
  }),
  patternRule({
    id: 'gen/no-acceptance',
    severity: 'info',
    guidance: 'Add a success criterion: "should …", "tests must pass", "done when …".',
    match: (text) => {
      if (text.trim().split(/\s+/).length < 5) return null;
      const verb = text.match(REQUEST_VERB)?.[0];
      return verb && !ACCEPTANCE.test(text) ? verb : null;
    },
    message: 'No acceptance criteria; the agent cannot tell when it is done.',
  }),
  patternRule({
    id: 'gen/repeated-correction',
    severity: 'warn',
    guidance: 'When you correct the agent twice, the first prompt was missing context. Put that context up front next time.',
    match: (_text, event) => (event.followUps.length >= 2 ? event.followUps.join(' | ') : null),
    message: 'You corrected the agent several times after this prompt.',
  }),
];
