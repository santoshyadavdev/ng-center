export function cleanText(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

const NOISE_PREFIXES = ['<command-', '<local-command', 'Caveat:', '<parameter name=', '<system_notification', '<cross_session_message', '<canvas-context'];
const TERMINAL_ESCAPE = /^(\u001b\[)?<\d+;\d+;\d+[Mm]/;

export function isNoise(text: string): boolean {
  return text === '' || NOISE_PREFIXES.some((p) => text.startsWith(p)) || TERMINAL_ESCAPE.test(text);
}
