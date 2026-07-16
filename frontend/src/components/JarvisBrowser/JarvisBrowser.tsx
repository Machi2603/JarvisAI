import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../lib/api';

type BrowserState = { url: string; title: string; screenshot: string };

export function JarvisBrowser() {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<BrowserState | null>(null);
  const [error, setError] = useState('INITIALIZING BROWSER');
  const [position, setPosition] = useState(() => ({ x: Math.max(24, window.innerWidth - Math.min(window.innerWidth * 0.44, 520) - 20), y: 112 }));
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await apiFetch('/v1/browser/state');
        if (!response.ok) throw new Error(await response.text());
        if (alive) { setState(await response.json()); setError(''); }
      } catch {
        if (alive) setError('BROWSER OFFLINE');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return;
      setPosition({ x: Math.max(0, event.clientX - drag.current.x), y: Math.max(0, event.clientY - drag.current.y) });
    };
    const release = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', release);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', release); };
  }, []);

  if (!open) return null;

  return (
    <section onMouseDown={(event) => { drag.current = { x: event.clientX - position.x, y: event.clientY - position.y }; }} style={{ transform: `translate(${position.x}px, ${position.y}px)` }} className="pointer-events-auto absolute left-0 top-0 z-20 w-[min(44vw,520px)] overflow-hidden rounded-xl border border-cyan-300/30 bg-slate-950/90 shadow-[0_0_36px_rgba(34,211,238,0.13)] backdrop-blur">
      <header className="flex cursor-grab items-center gap-2 border-b border-cyan-300/20 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-cyan-200 active:cursor-grabbing">
        <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_#67e8f9]" /> JARVIS BROWSER
        <span className="ml-auto max-w-[55%] truncate text-cyan-200/50">{state?.url || error}</span>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setOpen(false)}
          className="ml-1 rounded p-0.5 text-cyan-100/60 hover:bg-cyan-300/10 hover:text-cyan-100"
          title="Cerrar navegador"
          aria-label="Cerrar navegador"
        >
          <X size={14} />
        </button>
      </header>
      {state ? <img className="block aspect-video w-full object-cover" src={`data:image/png;base64,${state.screenshot}`} alt={state.title || 'Jarvis browser'} /> : <div className="flex aspect-video items-center justify-center font-mono text-xs tracking-widest text-cyan-200/50">{error}</div>}
    </section>
  );
}
