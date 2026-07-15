export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export function orbStateFromStream(isStreaming: boolean, phase: string): OrbState {
  if (!isStreaming) return 'idle';
  if (/listen|transcrib/i.test(phase)) return 'listening';
  if (/speak|audio/i.test(phase)) return 'speaking';
  return 'thinking';
}
