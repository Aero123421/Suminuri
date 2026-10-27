/** Axis-aligned box in document units (PDF points or image pixels), top-left origin. */
export interface Box { x: number; y: number; w: number; h: number }
export interface Mark extends Box { id: string; page: number }
export interface CharBox extends Box { ch: string }

export function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** A character counts as covered when at least a third of it is inside a box. */
export function covered(ch: Box, boxes: readonly Box[]): boolean {
  const area = Math.max(ch.w * ch.h, 1e-6);
  return boxes.some(b => overlapArea(ch, b) / area >= 1 / 3);
}

export function clampBox(b: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.min(b.x, width)), y = Math.max(0, Math.min(b.y, height));
  return { x, y, w: Math.max(0, Math.min(b.x + b.w, width) - x), h: Math.max(0, Math.min(b.y + b.h, height) - y) };
}

let counter = 0;
export const newId = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}`;
