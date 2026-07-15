import { describe, expect, it } from 'vitest';
import { commandAfterWakeWord, isCameraCommand, voiceErrorLabel } from './wake-word';

describe('commandAfterWakeWord', () => {
  it('keeps the instruction after Jarvis and ignores unrelated speech', () => {
    expect(commandAfterWakeWord('Jarvis, abre mi calendario')).toBe('abre mi calendario');
    expect(commandAfterWakeWord('Yarvis apaga la luz')).toBe('apaga la luz');
    expect(commandAfterWakeWord('buenos días equipo')).toBeNull();
  });

  it('surfaces microphone permission failures instead of a generic error', () => {
    expect(voiceErrorLabel(new DOMException('Permission denied', 'NotAllowedError'))).toBe(
      'NotAllowedError: Permission denied · constraint: n/a',
    );
    expect(voiceErrorLabel({
      name: 'OverconstrainedError',
      message: 'No matching device',
      constraint: 'deviceId',
    })).toContain('constraint: deviceId');
  });

  it('recognizes the camera command without requiring accents', () => {
    expect(isCameraCommand('abre la cámara')).toBe(true);
    expect(isCameraCommand('abre la camara')).toBe(true);
    expect(isCameraCommand('Abre la cámara.')).toBe(true);
    expect(isCameraCommand('abre el navegador')).toBe(false);
  });
});
