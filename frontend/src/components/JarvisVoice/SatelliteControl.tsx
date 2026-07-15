import { useEffect, useState } from 'react';
import { isTauri } from '../../lib/api';
import { connectSatellite, type SatelliteState } from './satellite';

async function revealDesktopOnWake(state: SatelliteState) {
  if (state !== 'listening' || !isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('show_main_window');
}

export function SatelliteControl() {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<SatelliteState>('starting');
  const [error, setError] = useState('');

  useEffect(() => connectSatellite(setConnected), []);
  useEffect(() => {
    const update = (event: Event) => {
      const nextState = (event as CustomEvent<SatelliteState>).detail;
      setState(nextState);
      setError('');
      void revealDesktopOnWake(nextState).catch(() => {});
    };
    const fail = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('jarvis-satellite-state', update);
    window.addEventListener('jarvis-satellite-error', fail);
    return () => {
      window.removeEventListener('jarvis-satellite-state', update);
      window.removeEventListener('jarvis-satellite-error', fail);
    };
  }, []);

  const label = !connected
    ? 'SATELLITE OFFLINE'
    : error
      ? error
      : state === 'idle'
        ? 'HEY JARVIS READY'
        : `JARVIS ${state.toUpperCase()}`;

  return (
    <div
      className="pointer-events-none absolute right-5 top-5 z-20 max-w-72 rounded-full border border-cyan-300/25 bg-slate-950/75 px-3 py-2 font-mono text-[9px] tracking-wider text-cyan-200/80 backdrop-blur"
      title={error || 'Windows audio satellite'}
    >
      {label}
    </div>
  );
}
