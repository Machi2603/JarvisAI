import { describe, expect, it } from 'vitest';
import { parseSatelliteMessage } from './satellite';

describe('parseSatelliteMessage', () => {
  it('accepts a transcript', () => {
    expect(parseSatelliteMessage('{"type":"transcript","text":"abre la cámara"}')).toEqual({
      type: 'transcript',
      text: 'abre la cámara',
    });
  });

  it('rejects malformed and unknown messages', () => {
    expect(parseSatelliteMessage('bad json')).toBeNull();
    expect(parseSatelliteMessage('{"type":"other"}')).toBeNull();
  });
});
