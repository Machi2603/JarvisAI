import { describe, expect, it } from 'vitest';
import { classifyHand } from './gesture';

const hand = (tipDistance: number) => Array.from({ length: 21 }, (_, index) => ({
  x: index === 5 ? 1 : [8, 12, 16, 20].includes(index) ? tipDistance : 0,
  y: 0,
}));

describe('classifyHand', () => {
  it('recognises open and closed hands from landmarks', () => {
    expect(classifyHand(hand(2))).toBe('open');
    expect(classifyHand(hand(1))).toBe('fist');
  });
});
