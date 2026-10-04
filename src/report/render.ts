import { ruleById } from '../rules/index.js';
import type { Ranked } from './score.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface RenderOptions {
  /** The database has prompts, but the report filters excluded all of them. */
  filtered?: boolean;
}

const FILTERED = 'No prompts matched the filters.';

export function renderText(ranked: Ranked[], opts: RenderOptions = {}): string {
  if (ranked.length === 0) {
    if (opts.filtered) return `${FILTERED}\n`;
    return 'No prompts to coach yet. Run `ngcoach scan` to import your agent history, then `ngcoach report`.\n';
  }
  const lines: string[] = [`Top ${ranked.length} prompts to improve`, ''];
  ranked.forEach(({ event: e, score }, i) => {
    lines.push(`${i + 1}. [${e.agent}] ${e.timestamp.slice(0, 10)} ${e.repo ?? '(no repo)'}  score ${score}`);
    for (const line of e.text.split('\n').slice(0, 6)) lines.push(`   > ${line}`);
    if (e.followUps.length) lines.push(`   ${plural(e.followUps.length, 'follow-up correction')}, outcome: ${e.outcome}`);
    for (const f of e.findings) {
      lines.push(`   ${f.severity.padEnd(5)} ${f.ruleId}: ${f.message}`);
      const guidance = ruleById(f.ruleId)?.guidance;
      if (guidance) lines.push(`         → ${guidance}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function renderJson(ranked: Ranked[]): string {
  return JSON.stringify({ prompts: ranked.map(({ event, score }) => ({ ...event, score })) }, null, 2);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderHtml(ranked: Ranked[], opts: RenderOptions = {}): string {
  const cards = ranked
    .map(({ event: e, score }) => {
      const findings = e.findings
        .map((f) => {
          const guidance = ruleById(f.ruleId)?.guidance;
          return `<li class="${esc(f.severity)}"><b>${esc(f.ruleId)}</b> ${esc(f.message)}${
            guidance ? `<div class="g">${esc(guidance)}</div>` : ''
          }</li>`;
        })
        .join('');
      const follow = e.followUps.length
        ? `<p class="meta">${esc(plural(e.followUps.length, 'follow-up correction'))}: ${e.followUps.map(esc).join(' · ')}</p>`
        : '';
      return `<section><p class="meta">${esc(e.agent)} · ${esc(e.timestamp.slice(0, 10))} · ${esc(e.repo ?? '(no repo)')} · score ${score}</p><pre>${esc(e.text)}</pre>${follow}<ol>${findings}</ol></section>`;
    })
    .join('\n');
  const empty = opts.filtered ? `<p>${FILTERED}</p>` : '<p>No prompts to coach yet. Run <code>ngcoach scan</code>.</p>';
  const body = cards || empty;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ngcoach report</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1f2328}
section{border:1px solid #d0d7de;border-radius:8px;padding:1rem;margin:1rem 0}
pre{white-space:pre-wrap;background:#f6f8fa;padding:.75rem;border-radius:6px}
.meta{color:#59636e;font-size:13px}.warn b{color:#9a6700}.info b{color:#0969da}.g{color:#59636e}
</style></head><body><h1>ngcoach: prompts to improve</h1>
${body}
</body></html>
`;
}
