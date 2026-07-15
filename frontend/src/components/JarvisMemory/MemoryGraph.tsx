import { BrainCircuit, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../lib/store';
import { buildMemoryGraph } from './memory-graph';

export function MemoryGraph() {
  const [open, setOpen] = useState(false);
  const conversations = useAppStore((state) => state.conversations);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const graph = buildMemoryGraph(conversations);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return <>
    <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute right-5 top-28 z-20 rounded-full border border-cyan-300/20 bg-slate-950/70 p-2 text-cyan-100 backdrop-blur hover:border-cyan-300/50" title="Open memory graph"><BrainCircuit size={16} /></button>
    {open && <div className="absolute inset-5 z-30 overflow-hidden rounded-3xl border border-cyan-300/20 bg-slate-950/95 shadow-2xl backdrop-blur"><header className="flex items-center justify-between border-b border-cyan-300/10 px-5 py-3 font-mono text-xs tracking-[0.2em] text-cyan-100"><span>MEMORY CONSTELLATION · {conversations.length} CONVERSATIONS</span><button onClick={() => setOpen(false)} title="Close"><X size={18} /></button></header><svg viewBox="0 0 100 100" className="h-[calc(100%-3rem)] w-full" aria-label="Jarvis memory graph">{graph.edges.map((edge) => { const from = byId.get(edge.from)!; const to = byId.get(edge.to)!; return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(103,232,249,.35)" strokeWidth="0.2" />; })}{graph.nodes.map((node) => <g key={node.id} className="cursor-pointer" onClick={() => { if (node.id !== 'jarvis') { selectConversation(node.id); setOpen(false); } }}><circle cx={node.x} cy={node.y} r={node.size / 2.8} fill={node.id === 'jarvis' ? '#22d3ee' : '#1d4ed8'} stroke="#a5f3fc" strokeWidth="0.2" /><text x={node.x} y={node.y + node.size / 2.8 + 3} textAnchor="middle" fill="#cffafe" fontSize="2.3">{node.label.slice(0, 18)}</text></g>)}</svg></div>}
  </>;
}
