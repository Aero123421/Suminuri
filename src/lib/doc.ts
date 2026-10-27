import type { CharBox, Mark } from './geometry';

/** A document the editor can show page by page and box-redact. Units are
 * PDF points for PDFs and pixels for images; the editor scales to the screen. */
export interface PageSize { width: number; height: number }
export interface SaveResult { blob: Blob; name: string; checks: string[] }
export interface RedactableDoc {
  kind: 'pdf' | 'image';
  name: string;
  pages: PageSize[];
  /** Draw a page at the given scale (1 = document units). */
  render(page: number, scale: number, canvas: HTMLCanvasElement): Promise<void>;
  /** Characters of the text layer with their boxes (empty for images and scans). */
  chars(page: number): Promise<CharBox[]>;
  save(marks: readonly Mark[], progress?: (done: number, total: number) => void): Promise<SaveResult>;
  close(): void;
}

export function outputName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/u, '');
  return `${base}_墨塗り.${ext}`;
}
