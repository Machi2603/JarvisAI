import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { classifyHand, type HandGesture } from './gesture';

type Props = { fullScreen?: boolean; onClose?: () => void };

export function CameraGestureControl({ fullScreen = false, onClose }: Props) {
  const [open, setOpen] = useState(fullScreen);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let armed = false;
    let dragging = false;
    let previous: HandGesture = 'unknown';
    let dwellStart = 0;
    const mouse = (type: 'mousedown' | 'mousemove' | 'mouseup', x: number, y: number) =>
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const draw = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) { frame = requestAnimationFrame(draw); return; }
      const result = landmarker.detectForVideo(video, performance.now());
      const context = canvas.getContext('2d');
      if (context) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; context.clearRect(0, 0, canvas.width, canvas.height); }
      const points = result.landmarks[0];
      const gesture = points ? classifyHand(points) : 'unknown';
      if (points && context) {
        const tip = points[8];
        const x = (1 - tip.x) * window.innerWidth;
        const y = tip.y * window.innerHeight;
        context.fillStyle = dragging ? '#fbbf24' : '#67e8f9';
        context.beginPath(); context.arc(tip.x * canvas.width, tip.y * canvas.height, 10, 0, Math.PI * 2); context.fill();
        if (gesture === 'open') {
          if (!dwellStart) dwellStart = performance.now();
          armed = performance.now() - dwellStart > 850;
          if (armed && dragging) { mouse('mouseup', x, y); dragging = false; }
        } else if (gesture === 'fist') {
          dwellStart = 0;
          if (armed && previous !== 'fist') { mouse('mousedown', x, y); dragging = true; }
          if (armed && dragging) mouse('mousemove', x, y);
        }
      }
      previous = gesture;
      frame = requestAnimationFrame(draw);
    };
    (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
        landmarker = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 });
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) return;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        frame = requestAnimationFrame(draw);
      } catch { setError('Camera or hand model unavailable'); }
    })();
    return () => { cancelled = true; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); landmarker?.close(); };
  }, [open]);

  const close = () => { setOpen(false); onClose?.(); };
  if (!open && !fullScreen) return <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute right-5 top-16 z-20 rounded-full border border-cyan-300/20 bg-slate-950/70 p-2 text-cyan-100 backdrop-blur hover:border-cyan-300/50" title="Enable hand control"><Camera size={16} /></button>;
  const frameClass = fullScreen ? 'pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black shadow-[inset_0_0_90px_rgba(148,163,184,0.72)]' : 'pointer-events-auto absolute right-5 top-16 z-20 w-72 overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950/90 shadow-2xl';
  return <div className={frameClass}><div className={fullScreen ? 'pointer-events-auto absolute right-5 top-5 z-10' : 'flex items-center justify-between px-3 py-2 font-mono text-[10px] tracking-wider text-cyan-100'}>{!fullScreen && <span>HAND CONTROL · OPEN TO ARM</span>}<button onClick={close} className="rounded-full border border-cyan-200/30 bg-slate-950/70 p-2 text-cyan-100"><X size={14} /></button></div><div className={fullScreen ? 'absolute inset-0' : 'relative aspect-video bg-black'}><video ref={videoRef} className="h-full w-full scale-x-[-1] object-cover" muted playsInline /><canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]" /></div>{error && <p className="pointer-events-auto absolute bottom-5 left-5 rounded bg-rose-950/80 p-2 text-xs text-rose-200">{error}</p>}</div>;
}
