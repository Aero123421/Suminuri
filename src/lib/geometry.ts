/** Axis-aligned box in document units (PDF points or image pixels), top-left origin. */
export interface Box { x: number; y: number; w: number; h: number }
export interface Mark extends Box { id: string; page: number }
export interface CharBox extends Box { ch: string }

export function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

const inside = (x: number, y: number, b: Box) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Share of a character covered by the union of the boxes, sampled on a 6×4 grid. */
export function coverage(ch: Box, boxes: readonly Box[]): number {
  let hit = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    const x = ch.x + ch.w * (i + 0.5) / 6, y = ch.y + ch.h * (j + 0.5) / 4;
    if (boxes.some(b => inside(x, y, b))) hit++;
  }
  return hit / 24;
}

/** A character a box touches meaningfully (a fifth or more) is erased whole. */
export const COVER_THRESHOLD = 0.2;
export function coveredChars(chars: readonly CharBox[], boxes: readonly Box[]): CharBox[] {
  if (!boxes.length) return [];
  return chars.filter(c => coverage(c, boxes) >= COVER_THRESHOLD);
}

/** Character boxes are estimates, so paint them with a margin around the glyph. */
export function padChar(c: Box): Box {
  const px = Math.max(0.6, c.h * 0.12), py = Math.max(0.4, c.h * 0.06);
  return { x: c.x - px, y: c.y - py, w: c.w + 2 * px, h: c.h + 2 * py };
}

/** Everything that will be black in the saved file: the boxes plus every covered character. */
export function paintBoxes(boxes: readonly Box[], chars: readonly CharBox[]): Box[] {
  return [...boxes, ...coveredChars(chars, boxes).map(padChar)];
}

export function clampBox(b: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.min(b.x, width)), y = Math.max(0, Math.min(b.y, height));
  return { x, y, w: Math.max(0, Math.min(b.x + b.w, width) - x), h: Math.max(0, Math.min(b.y + b.h, height) - y) };
}

let counter = 0;
export const newId = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}`;
