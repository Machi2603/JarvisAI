import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { ApprovalBell } from './ApprovalBell';
import { Sidebar } from './Sidebar/Sidebar';
import { SystemPulse } from './SystemPulse';
import { useAppStore } from '../lib/store';
import { checkHealth, getSetupStatus, type SetupStatus } from '../lib/api';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    const check = () => checkHealth().then(setApiReachable);
    check();
    const interval = setInterval(check, 30000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    const refresh = () => getSetupStatus().then(setSetupStatus).catch(() => {});
    refresh();
    const interval = setInterval(refresh, 1500);
    return () => clearInterval(interval);
  }, []);

  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative" style={{ paddingTop: '3px' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      <SystemPulse apiReachable={apiReachable} />
      <ApprovalBell />

      {/* Non-blocking backend status */}
      {setupStatus && setupStatus.phase !== 'ready' && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
          style={{
            background: setupStatus.error
              ? 'color-mix(in srgb, var(--color-error) 8%, transparent)'
              : 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
            borderBottom: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: setupStatus.error ? 'var(--color-error)' : 'var(--color-accent)' }} />
          <span>{setupStatus.error || setupStatus.detail || 'Configura un modelo en Ajustes'}</span>
          <button onClick={() => navigate('/settings')} className="text-sm underline cursor-pointer ml-auto shrink-0" style={{ color: 'var(--color-accent)' }}>
            Ajustes
          </button>
        </div>
      )}

      {/* Web/dev health check banner */}
      {!setupStatus && apiReachable === false && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-error) 15%, transparent)',
            color: 'var(--color-text)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--color-error)' }}
          />
          <span>Cannot reach OpenJarvis backend</span>
          <button
            onClick={() => navigate('/settings')}
            className="text-sm underline cursor-pointer ml-auto shrink-0"
            style={{ color: 'var(--color-accent)' }}
          >
            Change URL
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative z-10">
        <Sidebar />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => useAppStore.getState().setSidebarOpen(false)}
          />
        )}
        <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden" style={{ background: 'transparent' }}>
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative z-[2]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
