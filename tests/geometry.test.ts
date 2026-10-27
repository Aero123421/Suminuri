import test from 'node:test';
import assert from 'node:assert/strict';
import { coverage, coveredChars, padChar, paintBoxes, type CharBox } from '../src/lib/geometry';

const ch = (x: number, w = 10): CharBox => ({ ch: 'あ', x, y: 0, w, h: 10 });

test('coverage counts the union of several boxes, not each box alone', () => {
  const c = ch(0);
  const left = { x: 0, y: 0, w: 3, h: 10 }, right = { x: 7, y: 0, w: 3, h: 10 };
  assert.ok(coverage(c, [left]) < 0.4);
  assert.ok(coverage(c, [left, right]) >= 0.6);
});

test('a box touching a fifth of a character marks it; a sliver does not', () => {
  const chars = [ch(0), ch(10), ch(20)];
  assert.deepEqual(coveredChars(chars, [{ x: 0, y: 0, w: 2.5, h: 10 }]).map(c => c.x), [0]);
  assert.deepEqual(coveredChars(chars, [{ x: 0, y: 0, w: 0.5, h: 10 }]), []);
  assert.deepEqual(coveredChars(chars, []), []);
});

test('covered characters are painted whole, with a margin around the estimate', () => {
  const box = { x: 0, y: 0, w: 2.5, h: 10 };
  const painted = paintBoxes([box], [ch(0), ch(30)]);
  assert.equal(painted.length, 2);
  const glyph = painted[1];
  assert.ok(glyph.x < 0 && glyph.x + glyph.w > 10, 'the whole glyph and a margin are covered');
  const p = padChar({ x: 0, y: 0, w: 10, h: 10 });
  for (const [k, v] of Object.entries({ x: -1.2, y: -0.6, w: 12.4, h: 11.2 })) assert.ok(Math.abs(p[k as keyof typeof p] - v) < 1e-9, k);
});
