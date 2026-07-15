import type { Conversation } from '../../types';

export type MemoryNode = { id: string; label: string; x: number; y: number; size: number };
export type MemoryEdge = { from: string; to: string };

export function buildMemoryGraph(conversations: Conversation[]): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
  const recent = conversations.slice(0, 8);
  const nodes: MemoryNode[] = [{ id: 'jarvis', label: 'JARVIS', x: 50, y: 50, size: 12 }];
  const edges: MemoryEdge[] = [];
  recent.forEach((conversation, index) => {
    const angle = (index / Math.max(recent.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = 31 + (index % 2) * 8;
    nodes.push({ id: conversation.id, label: conversation.title || 'Conversation', x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, size: 5 + Math.min(conversation.messages.length, 5) });
    edges.push({ from: 'jarvis', to: conversation.id });
  });
  return { nodes, edges };
}
