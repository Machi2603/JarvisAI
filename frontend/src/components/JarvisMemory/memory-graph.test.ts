import { describe, expect, it } from 'vitest';
import { buildMemoryGraph } from './memory-graph';

describe('buildMemoryGraph', () => {
  it('connects each recent conversation to Jarvis', () => {
    const graph = buildMemoryGraph([{ id: 'a', title: 'Alpha', createdAt: 0, updatedAt: 0, model: 'x', messages: [] }]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([{ from: 'jarvis', to: 'a' }]);
  });
});
