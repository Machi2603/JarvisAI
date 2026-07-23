import { orbAudio } from '../JarvisOrb/orbAudio';

export type SatelliteState = 'starting' | 'idle' | 'listening' | 'transcribing' | 'speaking';

export type SatelliteMessage =
  | { type: 'state'; state: SatelliteState }
  | { type: 'transcript'; text: string }
  | { type: 'level'; level: number }
  | { type: 'error'; message: string };

let socket: WebSocket | null = null;

export function parseSatelliteMessage(raw: string): SatelliteMessage | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'state' && typeof value.state === 'string') return value as SatelliteMessage;
    if (value.type === 'transcript' && typeof value.text === 'string') return value as SatelliteMessage;
    if (value.type === 'level' && typeof value.level === 'number') return value as SatelliteMessage;
    if (value.type === 'error' && typeof value.message === 'string') return value as SatelliteMessage;
  } catch {
    // Ignore malformed messages from a stale or incompatible local process.
  }
  return null;
}

export function connectSatellite(onConnection: (connected: boolean) => void): () => void {
  let stopped = false;
  let reconnect = 0;

  const connect = () => {
    if (stopped) return;
    const current = new WebSocket('ws://127.0.0.1:8765');
    socket = current;
    current.onopen = () => onConnection(true);
    current.onmessage = ({ data }) => {
      const message = parseSatelliteMessage(String(data));
      if (!message) return;
      if (message.type === 'transcript') {
        window.dispatchEvent(new CustomEvent<string>('jarvis-command', { detail: message.text }));
      } else if (message.type === 'state') {
        window.dispatchEvent(new CustomEvent<SatelliteState>('jarvis-satellite-state', { detail: message.state }));
      } else if (message.type === 'level') {
        orbAudio.level = Math.max(0, Math.min(1, message.level));
      } else {
        window.dispatchEvent(new CustomEvent<string>('jarvis-satellite-error', { detail: message.message }));
      }
    };
    current.onclose = () => {
      if (socket === current) socket = null;
      orbAudio.level = 0;
      onConnection(false);
      if (!stopped) reconnect = window.setTimeout(connect, 2_000);
    };
    current.onerror = () => current.close();
  };

  connect();
  return () => {
    stopped = true;
    window.clearTimeout(reconnect);
    socket?.close();
    socket = null;
    orbAudio.level = 0;
  };
}

export function speakThroughSatellite(text: string, voiceId = 'em_alex'): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'speak', text, voice_id: voiceId }));
  return true;
}

export function stopSatelliteSpeech(): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop_speaking' }));
}
