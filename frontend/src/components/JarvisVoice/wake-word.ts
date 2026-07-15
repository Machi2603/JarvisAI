export function commandAfterWakeWord(transcript: string): string | null {
  const match = transcript.match(/\b(?:jarvis|yarvis|gervis)\b[,:;\s-]*(.+)/i);
  return match?.[1]?.trim() || null;
}

export function isCameraCommand(command: string): boolean {
  const normalized = command
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/gi, '')
    .trim()
    .toLowerCase();
  return normalized === 'abre la camara';
}

export function voiceErrorLabel(error: unknown): string {
  if (!error || typeof error !== 'object') return `UnknownError: ${String(error)} · constraint: n/a`;
  const value = error as { name?: unknown; message?: unknown; constraint?: unknown };
  const name = typeof value.name === 'string' && value.name ? value.name : 'Error';
  const message = typeof value.message === 'string' && value.message ? value.message : 'No message';
  const constraint = typeof value.constraint === 'string' && value.constraint ? value.constraint : 'n/a';
  return `${name}: ${message} · constraint: ${constraint}`;
}
