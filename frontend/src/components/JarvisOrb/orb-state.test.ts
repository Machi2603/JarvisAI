import { describe, expect, it } from 'vitest';
import { orbStateFromStream } from './orb-state';

describe('orbStateFromStream', () => {
  it('maps the assistant lifecycle to visible orb states', () => {
    expect(orbStateFromStream(false, '')).toBe('idle');
    expect(orbStateFromStream(true, 'transcribing')).toBe('listening');
    expect(orbStateFromStream(true, 'generating')).toBe('thinking');
    expect(orbStateFromStream(true, 'audio playback')).toBe('speaking');
  });
});
