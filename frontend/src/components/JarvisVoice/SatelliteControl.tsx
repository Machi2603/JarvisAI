import { useEffect } from 'react';
import { isTauri } from '../../lib/api';
import { connectSatellite, type SatelliteState } from './satellite';

async function revealDesktopOnWake(state: SatelliteState) {
  if (state !== 'listening' || !isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('show_main_window');
}

export function SatelliteControl() {
  useEffect(() => connectSatellite(() => {}), []);
  useEffect(() => {
    const update = (event: Event) => {
      const nextState = (event as CustomEvent<SatelliteState>).detail;
      void revealDesktopOnWake(nextState).catch(() => {});
    };
    window.addEventListener('jarvis-satellite-state', update);
    return () => {
      window.removeEventListener('jarvis-satellite-state', update);
    };
  }, []);
  return null;
}
