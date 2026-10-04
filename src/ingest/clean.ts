const INJECTED_BLOCK = /<(system-reminder|ide_opened_file|ide_selection|canvas-context)\b[^>]*>[\s\S]*?<\/\1>/g;

export function cleanText(text: string): string {
  return text.replace(INJECTED_BLOCK, '').trim();
}

const NOISE_PREFIXES = [
  '<command-',
  '<local-command',
  'Caveat:',
  '<parameter name=',
  '<system_notification',
  '<cross_session_message',
  '<canvas-context',
  '[Request interrupted by user',
];
const TERMINAL_ESCAPE = /^(\u001b\[)?<\d+;\d+;\d+[Mm]/;

export function isNoise(text: string): boolean {
  return text === '' || NOISE_PREFIXES.some((p) => text.startsWith(p)) || TERMINAL_ESCAPE.test(text);
}
