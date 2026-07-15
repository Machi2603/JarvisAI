import { useEffect, useRef, useState } from 'react';
import { ChatArea } from '../components/Chat/ChatArea';
import { CameraGestureControl } from '../components/JarvisCamera/CameraGestureControl';
import { MemoryGraph } from '../components/JarvisMemory/MemoryGraph';
import { JarvisOrb } from '../components/JarvisOrb/JarvisOrb';
import { orbStateFromStream } from '../components/JarvisOrb/orb-state';
import { SatelliteControl } from '../components/JarvisVoice/SatelliteControl';
import { speakThroughSatellite, stopSatelliteSpeech, type SatelliteState } from '../components/JarvisVoice/satellite';
import { JarvisBrowser } from '../components/JarvisBrowser/JarvisBrowser';
import { useAppStore } from '../lib/store';

export function ChatPage() {
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  // While Jarvis is actually speaking, the orb goes into its reactive
  // 'speaking' state; the orb expands with the real voice waveform.
  const orbState = speaking ? 'speaking' : orbStateFromStream(streamState.isStreaming, streamState.phase);
  const spokenMessage = useRef<string>('');

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (streamState.isStreaming || !last || last.role !== 'assistant' || !last.content || spokenMessage.current === last.id) return;
    spokenMessage.current = last.id;
    setVoiceError(!speakThroughSatellite(last.content));
  }, [messages, streamState.isStreaming]);

  useEffect(() => {
    const stop = () => stopSatelliteSpeech();
    const update = (event: Event) => {
      const state = (event as CustomEvent<SatelliteState>).detail;
      setSpeaking(state === 'speaking');
      if (state === 'speaking') setVoiceError(false);
    };
    window.addEventListener('jarvis-stop-speaking', stop);
    window.addEventListener('jarvis-satellite-state', update);
    return () => {
      window.removeEventListener('jarvis-stop-speaking', stop);
      window.removeEventListener('jarvis-satellite-state', update);
    };
  }, []);

  useEffect(() => {
    const openCamera = () => setCameraMode(true);
    const closeCamera = () => setCameraMode(false);
    window.addEventListener('jarvis-camera-open', openCamera);
    window.addEventListener('jarvis-camera-close', closeCamera);
    return () => {
      window.removeEventListener('jarvis-camera-open', openCamera);
      window.removeEventListener('jarvis-camera-close', closeCamera);
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden bg-[#02070c]">
      <div className="relative flex-1 min-w-0 overflow-hidden">
        {cameraMode && <CameraGestureControl fullScreen onClose={() => setCameraMode(false)} />}
        <JarvisOrb state={orbState} compact={cameraMode} />
        {!cameraMode && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,rgba(2,7,12,0.38)_75%,#02070c_100%)]" />}
        <div className="pointer-events-none absolute left-6 top-5 font-mono text-[10px] tracking-[0.28em] text-cyan-200/70">
          J.A.R.V.I.S. <span className="text-cyan-400">// {orbState.toUpperCase()}</span>
        </div>
        <SatelliteControl />
        {voiceError && (
          <div className="pointer-events-none absolute right-5 top-28 z-20 rounded-full border border-amber-300/30 bg-slate-950/80 px-3 py-2 font-mono text-[9px] tracking-wider text-amber-200 backdrop-blur">
            START JARVIS AUDIO SATELLITE
          </div>
        )}
        <JarvisBrowser />
        <MemoryGraph />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[42vh] bg-gradient-to-t from-[#02070c] via-[#02070c]/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 z-10">
          <ChatArea />
        </div>
      </div>
    </div>
  );
}
