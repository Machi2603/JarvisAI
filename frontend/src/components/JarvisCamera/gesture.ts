export type Point = { x: number; y: number; z?: number };
export type HandGesture = 'open' | 'fist' | 'unknown';

export function classifyHand(landmarks: Point[]): HandGesture {
  if (landmarks.length < 21) return 'unknown';
  const wrist = landmarks[0];
  const palm = Math.hypot(landmarks[5].x - wrist.x, landmarks[5].y - wrist.y) || 1;
  const tips = [8, 12, 16, 20].map((index) => Math.hypot(landmarks[index].x - wrist.x, landmarks[index].y - wrist.y) / palm);
  const extended = tips.filter((distance) => distance > 1.55).length;
  if (extended >= 3) return 'open';
  if (tips.every((distance) => distance < 1.25)) return 'fist';
  return 'unknown';
}
