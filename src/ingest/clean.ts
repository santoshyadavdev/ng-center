export function cleanText(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

export function isNoise(text: string): boolean {
  return text === '' || text.startsWith('<command-') || text.startsWith('<local-command') || text.startsWith('Caveat:');
}
