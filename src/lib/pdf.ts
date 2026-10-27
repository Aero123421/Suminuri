import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import type { CharBox, Mark } from './geometry';
import { outputName, type RedactableDoc, type SaveResult } from './doc';

let workerReady = false;
function ensureWorker(): void {
  if (workerReady) return;
  GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  workerReady = true;
}

const asset = (dir: string) => `${import.meta.env.BASE_URL}pdfjs/${dir}/`;
async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  ensureWorker();
  const task = getDocument({
    data, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm'),
    isEvalSupported: false, enableXfa: false, verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
  task.onPassword = () => { void task.destroy(); };
  return task.promise;
}

const mul = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** Width of one character relative to a full-width (CJK) character. PDF.js gives
 * the width of a whole text run only, so per-character boxes are estimates. */
function weight(ch: string): number {
  if (/\s/u.test(ch)) return 0.3;
  const c = ch.codePointAt(0)!;
  if (c > 0xffff || (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
    || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)) return 1;
  return 0.55;
}

interface TextItemLike { str: string; transform: number[]; width: number; height: number; fontName: string }

/** Character boxes of a page's text layer, in page points (top-left origin, rotation applied). */
export async function pageChars(page: PDFPageProxy): Promise<CharBox[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { vertical?: boolean; ascent?: number; descent?: number }>;
  const out: CharBox[] = [];
  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const item = raw as unknown as TextItemLike;
    if (!item.str.trim()) continue;
    const style = styles[item.fontName] ?? {};
    const t = mul(viewport.transform, item.transform);
    const size = Math.hypot(t[2], t[3]);
    if (!Number.isFinite(size) || size <= 0) continue;
    let angle = Math.atan2(t[1], t[0]);
    const length = style.vertical ? Math.abs(item.height) : Math.abs(item.width);
    if (style.vertical) angle += Math.PI / 2;
    const u = [Math.cos(angle), Math.sin(angle)];
    const n = [Math.sin(angle), -Math.cos(angle)];
    // Across the line: ascent above the baseline, descent below; vertical text is centred on its axis.
    const [lo, hi] = style.vertical ? [-size / 2, size / 2] : [-0.22 * size, 0.88 * size];
    const chars = [...item.str];
    const total = chars.reduce((s, ch) => s + weight(ch), 0) || 1;
    let at = 0;
    for (const ch of chars) {
      const step = weight(ch) / total * length;
      if (!/\s/u.test(ch)) {
        const pts = [at, at + step].flatMap(s => [lo, hi].map(k => [t[4] + u[0] * s + n[0] * k, t[5] + u[1] * s + n[1] * k]));
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        out.push({ ch, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
      }
      at += step;
    }
  }
  return out;
}

async function renderTo(page: PDFPageProxy, scale: number, canvas: HTMLCanvasElement): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false })!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport, annotationMode: AnnotationMode.ENABLE } as Parameters<PDFPageProxy['render']>[0]).promise;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像に変換できませんでした')), type, quality));

const SAVE_DPI = 200;
const MAX_PIXELS = 24_000_000;

/** Every page becomes a picture with the boxes painted solid black, so no text,
 * metadata, annotation or attachment of the original survives in the output. */
export async function savePdf(doc: PDFDocumentProxy, name: string, marks: readonly Mark[], progress?: (done: number, total: number) => void): Promise<SaveResult> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const canvas = document.createElement('canvas');
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    let scale = SAVE_DPI / 72;
    if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    await renderTo(page, scale, canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    for (const m of marks.filter(m => m.page === p)) {
      // Round outward so no partial pixel of the covered area survives.
      const x0 = Math.floor(m.x * scale), y0 = Math.floor(m.y * scale);
      ctx.fillRect(x0, y0, Math.ceil((m.x + m.w) * scale) - x0, Math.ceil((m.y + m.h) * scale) - y0);
    }
    const jpg = await out.embedJpg(new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer()));
    const target = out.addPage([base.width, base.height]);
    target.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    page.cleanup();
    progress?.(p, doc.numPages);
  }
  canvas.width = canvas.height = 1;
  const bytes = await out.save({ useObjectStreams: true });
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return { blob, name: outputName(name, 'pdf'), checks: await verifyPdf(bytes, marks) };
}

/** Re-open the saved bytes: there must be no text layer, and every box must be black. */
async function verifyPdf(bytes: Uint8Array, marks: readonly Mark[]): Promise<string[]> {
  const doc = await open(bytes.slice());
  try {
    let text = 0;
    const canvas = document.createElement('canvas');
    let dark = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      text += (await page.getTextContent()).items.filter(i => 'str' in i && i.str.trim()).length;
      const pageMarks = marks.filter(m => m.page === p);
      if (pageMarks.length) {
        await renderTo(page, 2, canvas);
        const ctx = canvas.getContext('2d')!;
        for (const m of pageMarks) {
          const px = ctx.getImageData(Math.floor((m.x + m.w / 2) * 2), Math.floor((m.y + m.h / 2) * 2), 1, 1).data;
          if (px[0] < 40 && px[1] < 40 && px[2] < 40) dark++;
        }
      }
      page.cleanup();
    }
    canvas.width = canvas.height = 1;
    if (text) throw new Error('保存した PDF に文字が残っています');
    if (dark !== marks.length) throw new Error('保存した PDF で塗れていない所があります');
    return ['文字のデータは残っていません', `${marks.length} か所すべて黒く塗られています`];
  } finally { await doc.loadingTask.destroy(); }
}

export async function loadPdf(file: File): Promise<RedactableDoc> {
  const doc = await open(new Uint8Array(await file.arrayBuffer()));
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const v = (await doc.getPage(p)).getViewport({ scale: 1 });
    pages.push({ width: v.width, height: v.height });
  }
  const charCache = new Map<number, Promise<CharBox[]>>();
  return {
    kind: 'pdf', name: file.name, pages,
    render: async (p, scale, canvas) => renderTo(await doc.getPage(p), scale, canvas),
    chars: p => {
      if (!charCache.has(p)) charCache.set(p, doc.getPage(p).then(pageChars).catch(() => []));
      return charCache.get(p)!;
    },
    save: (marks, progress) => savePdf(doc, file.name, marks, progress),
    close: () => { void doc.loadingTask.destroy(); },
  };
}
