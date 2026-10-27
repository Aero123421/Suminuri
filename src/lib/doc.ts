import type { Box, CharBox, Mark } from './geometry';

/** A document the editor can show page by page and box-redact. Units are
 * PDF points for PDFs and pixels for images; the editor scales to the screen. */
export interface PageSize { width: number; height: number }
export interface SaveResult { blob: Blob; name: string; checks: string[] }
export interface RedactableDoc {
  kind: 'pdf' | 'image';
  name: string;
  pages: PageSize[];
  /** Draw a page at the given scale (1 = document units). Abort cancels the drawing. */
  render(page: number, scale: number, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void>;
  /** Characters of the text layer with their boxes ([] for images and scans). Rejects if the text layer can't be read. */
  chars(page: number): Promise<CharBox[]>;
  save(marks: readonly Mark[], progress?: (done: number, total: number, phase: 'write' | 'check') => void): Promise<SaveResult>;
  close(): void;
}

export function outputName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/u, '');
  return `${base}_墨塗り.${ext}`;
}

/** Pixel budgets shared by display, saving and checking (RGBA = 4 bytes per pixel). */
export const LIMITS = { displayPixels: 12_000_000, savePixels: 24_000_000, checkPixels: 16_000_000, imagePixels: 50_000_000, imageSide: 16_384, pages: 500 };

/** User-facing error: short Japanese text, technical detail kept separately. */
export class UserError extends Error {
  constructor(message: string, readonly detail?: string) { super(message); }
}

/**
 * Check that every painted box is solid black in the saved pixels. Samples a
 * grid over the whole box (not just its centre), inset by 1.5 device pixels
 * because JPEG softens the very edge. Fully transparent black is not black.
 */
export function checkBlack(data: ImageData, boxes: readonly Box[], scale: number): { ok: boolean; worst: number } {
  let worst = 1;
  for (const b of boxes) {
    const x0 = b.x * scale + 1.5, y0 = b.y * scale + 1.5, x1 = (b.x + b.w) * scale - 1.5, y1 = (b.y + b.h) * scale - 1.5;
    if (x1 <= x0 || y1 <= y0) continue; // thinner than three device pixels: nothing reliable to sample
    const step = Math.max(1, Math.min(x1 - x0, y1 - y0) / 24);
    let total = 0, dark = 0;
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const i = (Math.floor(y) * data.width + Math.floor(x)) * 4;
      if (Math.floor(x) >= data.width || Math.floor(y) >= data.height) continue;
      total++;
      if (data.data[i + 3] === 255 && Math.max(data.data[i], data.data[i + 1], data.data[i + 2]) < 64) dark++;
    }
    if (total) worst = Math.min(worst, dark / total);
  }
  return { ok: worst >= 0.995, worst };
}
