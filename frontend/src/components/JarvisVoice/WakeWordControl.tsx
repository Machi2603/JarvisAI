import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiKey, getBase, transcribeAudio } from '../../lib/api';
import { commandAfterWakeWord, voiceErrorLabel } from './wake-word';

function wavBlob(chunks: Int16Array[]): Blob {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  chunks.forEach((chunk) => chunk.forEach((sample) => { view.setInt16(offset, sample, true); offset += 2; }));
  return new Blob([buffer], { type: 'audio/wav' });
}

function pcm16(input: Float32Array, rate: number): Int16Array {
  const output = new Int16Array(Math.floor(input.length * 16000 / rate));
  for (let i = 0; i < output.length; i += 1) output[i] = Math.max(-1, Math.min(1, input[Math.floor(i * rate / 16000)])) * 0x7fff;
  return output;
}

const VOICE_THRESHOLD = 0.018;
const COMMAND_SILENCE_MS = 900;
const MAX_COMMAND_SAMPLES = 16 * 16000;
const RECENT_FRAME_COUNT = 14;

function wakeWordUrl(): string {
  const base = getBase() || window.location.origin;
  const url = new URL('/v1/speech/wake-word', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const key = getApiKey();
  if (key) url.searchParams.set('token', key);
  return url.toString();
}

export function WakeWordControl() {
  const stopRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const jarvisSpeakingRef = useRef(false);
  const [microphoneError, setMicrophoneError] = useState('MICROPHONE ACTIVATION REQUIRED');
  const stop = useCallback(() => {
    const cleanup = stopRef.current;
    stopRef.current = null;
    cleanup?.();
  }, []);
  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    stop();
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silent: GainNode | null = null;
    let socket: WebSocket | null = null;
    let stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      processor?.disconnect(); source?.disconnect(); silent?.disconnect();
      socket?.close();
      if (context) void context.close();
      stream?.getTracks().forEach((track) => track.stop());
    };
    try {
      if (!window.isSecureContext) throw new DOMException(`Microphone requires a secure context; current origin is ${window.location.origin}`, 'SecurityError');
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('getUserMedia is unavailable in this context', 'NotSupportedError');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopRef.current = cleanup;
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      silent = context.createGain(); silent.gain.value = 0;
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      socket = new WebSocket(wakeWordUrl());
      const activeContext = context;
      const activeSocket = socket;
      const recent: Int16Array[] = [];
      let command: Int16Array[] | null = null;
      let lastVoice = 0;
      let mutedResetSent = false;
      const submit = async () => {
        const audio = command; command = null;
        if (!audio) return;
        if (audio.reduce((total, chunk) => total + chunk.length, 0) >= 4800) try {
          const result = await transcribeAudio(wavBlob(audio), 'jarvis-command.wav', 'es');
          const text = commandAfterWakeWord(result.text);
          if (text) window.dispatchEvent(new CustomEvent<string>('jarvis-command', { detail: text }));
        } catch { /* Discard a failed local transcription. */ }
      };
      activeSocket.onmessage = ({ data }) => {
        try {
          if (JSON.parse(data).type !== 'detected' || command) return;
          command = [...recent];
          lastVoice = performance.now();
        } catch { /* Ignore malformed server messages. */ }
      };
      processor.onaudioprocess = ({ inputBuffer }) => {
        if (stopped) return;
        if (jarvisSpeakingRef.current) {
          recent.length = 0;
          if (!mutedResetSent && activeSocket.readyState === WebSocket.OPEN) {
            activeSocket.send('reset');
            mutedResetSent = true;
          }
          return;
        }
        mutedResetSent = false;
        const frame = pcm16(inputBuffer.getChannelData(0), activeContext.sampleRate);
        const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length) / 0x7fff;
        recent.push(frame);
        if (recent.length > RECENT_FRAME_COUNT) recent.shift();
        if (!command) {
          if (activeSocket.readyState === WebSocket.OPEN) activeSocket.send(frame.buffer);
          return;
        }
        command.push(frame);
        if (rms > VOICE_THRESHOLD) lastVoice = performance.now();
        const length = command.reduce((total, chunk) => total + chunk.length, 0);
        if (performance.now() - lastVoice > COMMAND_SILENCE_MS || length > MAX_COMMAND_SAMPLES) void submit();
      };
      await activeContext.resume();
      setMicrophoneError('');
    } catch (error) {
      cleanup();
      if (stopRef.current === cleanup) stopRef.current = null;
      setMicrophoneError(voiceErrorLabel(error));
    } finally {
      startingRef.current = false;
    }
  }, [stop]);

  useEffect(() => {
    const update = (event: Event) => {
      jarvisSpeakingRef.current = (event as CustomEvent<boolean>).detail;
    };
    window.addEventListener('jarvis-speaking', update);
    return () => window.removeEventListener('jarvis-speaking', update);
  }, []);

  useEffect(() => {
    let disposed = false;
    let permission: PermissionStatus | null = null;
    if (!window.isSecureContext) {
      setMicrophoneError(voiceErrorLabel(new DOMException(`Microphone requires a secure context; current origin is ${window.location.origin}`, 'SecurityError')));
      return stop;
    }
    if (!navigator.permissions?.query) return stop;
    navigator.permissions.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (disposed) return;
        permission = status;
        if (status.state === 'granted') void start();
        status.onchange = () => {
          if (status.state === 'granted') void start();
          else {
            stop();
            setMicrophoneError('MICROPHONE ACTIVATION REQUIRED');
          }
        };
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (permission) permission.onchange = null;
      stop();
    };
  }, [start, stop]);

  if (!microphoneError) return null;
  return (
    <button
      type="button"
      onClick={() => void start()}
      className="pointer-events-auto absolute right-5 top-5 z-30 rounded-full border border-amber-300/40 bg-slate-950/90 px-3 py-1.5 font-mono text-[10px] tracking-wide text-amber-100 backdrop-blur hover:border-amber-200 cursor-pointer"
      title={microphoneError}
    >
      {microphoneError} · ACTIVATE MICROPHONE
    </button>
  );
}
