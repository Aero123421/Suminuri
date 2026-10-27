import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { paintBoxes, type Box, type CharBox, type Mark } from './geometry';
import { checkBlack, LIMITS, outputName, UserError, type PageSize, type RedactableDoc, type SaveResult } from './doc';

let workerReady = false;
function ensureWorker(): void {
  if (workerReady) return;
  GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  workerReady = true;
}

const asset = (dir: string) => `${import.meta.env.BASE_URL}pdfjs/${dir}/`;
async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  ensureWorker();
  const task = getDocument({ data, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm'), enableXfa: false, verbosity: 0 });
  try { return await task.promise; }
  catch (error) {
    void task.destroy();
    const name = (error as { name?: string })?.name ?? '';
    const detail = error instanceof Error ? error.message : String(error);
    if (name === 'PasswordException') throw new UserError('パスワード付きの PDF は開けません。パスワードを外してから開いてください。', detail);
    if (name === 'InvalidPDFException') throw new UserError('PDF が壊れているか、PDF ではないファイルです。', detail);
    throw new UserError('この PDF は開けませんでした。', detail);
  }
}

const mul = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

// Relative widths of the characters in a run, measured with a similar system font.
// PDF.js reports only the width of a whole run; this keeps "WWWWiiii" proportional.
let measure: OffscreenCanvasRenderingContext2D | null = null;
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
function clusters(text: string): string[] {
  return segmenter ? [...segmenter.segment(text)].map(s => s.segment) : [...text];
}
function widths(parts: string[], family: string): number[] {
  measure ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (measure) {
    measure.font = `100px ${/serif|mono/u.test(family) ? family : 'sans-serif'}`;
    const w = parts.map(p => /^\s+$/u.test(p) ? measure!.measureText(' ').width : measure!.measureText(p).width);
    if (w.every(Number.isFinite) && w.some(x => x > 0)) return w.map(x => Math.max(x, 1));
  }
  return parts.map(p => /^\s+$/u.test(p) ? 30 : /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(p) || p.codePointAt(0)! > 0xffff ? 100 : 55);
}

interface TextItemLike { str: string; transform: number[]; width: number; height: number; fontName: string }
interface FontStyle { vertical?: boolean; ascent?: number; descent?: number; fontFamily?: string }

/** Character boxes of a page's text layer, in viewport units at scale 1 (top-left origin, rotation and UserUnit applied). */
export async function pageChars(page: PDFPageProxy): Promise<CharBox[]> {
  const viewport = page.getViewport({ scale: 1 });
  const unit = Math.hypot(viewport.transform[0], viewport.transform[1]) || Math.hypot(viewport.transform[2], viewport.transform[3]) || 1; // UserUnit
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, FontStyle>;
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
    const length = (style.vertical ? Math.abs(item.height) : Math.abs(item.width)) * unit;
    if (style.vertical) angle += Math.PI / 2;
    const u = [Math.cos(angle), Math.sin(angle)];
    const n = [Math.sin(angle), -Math.cos(angle)];
    const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const ascent = Math.min(Math.max(num(style.ascent, 0.88), 0.7), 1.1), descent = Math.min(Math.max(-num(style.descent, -0.22), 0.1), 0.4);
    const [lo, hi] = style.vertical ? [-size / 2, size / 2] : [-descent * size, ascent * size];
    const parts = clusters(item.str);
    const w = widths(parts, style.fontFamily ?? 'sans-serif');
    const total = w.reduce((s, x) => s + x, 0);
    let at = 0;
    parts.forEach((ch, i) => {
      const step = w[i] / total * length;
      if (ch.trim()) {
        const pts = [at, at + step].flatMap(s => [lo, hi].map(k => [t[4] + u[0] * s + n[0] * k, t[5] + u[1] * s + n[1] * k]));
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        const box = { ch, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        if ([box.x, box.y, box.w, box.h].every(Number.isFinite)) out.push(box);
      }
      at += step;
    });
  }
  return out;
}

async function renderTo(page: PDFPageProxy, scale: number, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false })!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvas, canvasContext: context, viewport, annotationMode: AnnotationMode.ENABLE } as Parameters<PDFPageProxy['render']>[0]);
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try { await task.promise; } finally { signal?.removeEventListener('abort', abort); }
}

/** Largest scale ≤ wanted that keeps the page within a pixel budget. */
const capScale = (size: PageSize, wanted: number, budget: number) => Math.min(wanted, Math.sqrt(budget / (size.width * size.height)));

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new UserError('ページを画像にできませんでした（メモリ不足の可能性があります）。')), type, quality));

const SAVE_DPI = 200;

/** Every page becomes a picture with the boxes (and every covered character) painted
 * solid black, so no text, metadata, annotation or attachment of the original survives. */
async function savePdf(doc: PDFDocumentProxy, name: string, pages: PageSize[], charsOf: (p: number) => Promise<CharBox[]>,
  marks: readonly Mark[], progress?: (done: number, total: number, phase: 'write' | 'check') => void): Promise<SaveResult> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const canvas = document.createElement('canvas');
  const painted = new Map<number, Box[]>();
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const pageMarks = marks.filter(m => m.page === p);
      const boxes = pageMarks.length ? paintBoxes(pageMarks, await charsOf(p).catch(() => [])) : [];
      painted.set(p, boxes);
      const page = await doc.getPage(p);
      const scale = capScale(pages[p - 1], SAVE_DPI / 72, LIMITS.savePixels);
      await renderTo(page, scale, canvas);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      for (const b of boxes) {
        // Round outward so no partial pixel of the covered area survives.
        const x0 = Math.floor(b.x * scale), y0 = Math.floor(b.y * scale);
        ctx.fillRect(x0, y0, Math.ceil((b.x + b.w) * scale) - x0, Math.ceil((b.y + b.h) * scale) - y0);
      }
      const jpg = await out.embedJpg(new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer()));
      const target = out.addPage([pages[p - 1].width, pages[p - 1].height]);
      target.drawImage(jpg, { x: 0, y: 0, width: pages[p - 1].width, height: pages[p - 1].height });
      page.cleanup();
      progress?.(p, doc.numPages, 'write');
    }
  } finally { canvas.width = canvas.height = 1; }
  const bytes = await out.save({ useObjectStreams: false });
  const checks = await verifyPdf(bytes, pages, painted, (done, total) => progress?.(done, total, 'check'));
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), name: outputName(name, 'pdf'), checks };
}

/** Re-open the saved bytes and check them independently of how they were written. */
async function verifyPdf(bytes: Uint8Array, pages: PageSize[], painted: Map<number, Box[]>, progress: (done: number, total: number) => void): Promise<string[]> {
  // 1. Structure: only pages with one image each; no info, outline, form, names, metadata or annotations.
  const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
  if (parsed.context.trailerInfo.Info || parsed.context.trailerInfo.Encrypt) throw new UserError('保存した PDF に余分な情報が入っています。');
  const catalogKeys = parsed.catalog.keys().map(k => k.decodeText());
  if (catalogKeys.some(k => !['Type', 'Pages'].includes(k))) throw new UserError('保存した PDF に余分な情報が入っています。', catalogKeys.join(','));
  const outPages = parsed.getPages();
  if (outPages.length !== pages.length) throw new UserError('保存した PDF のページ数が元と違います。');
  for (const [i, page] of outPages.entries()) {
    // pdf-lib adds an empty Annots array when drawing; any entry in it would be a leak.
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots && annots.size() > 0) throw new UserError('保存した PDF に注釈が残っています。');
    const { width, height } = page.getSize();
    if (Math.abs(width - pages[i].width) > 0.5 || Math.abs(height - pages[i].height) > 0.5) throw new UserError('保存した PDF のページの大きさが元と違います。');
  }
  // 2. Text and pixels, through PDF.js: no text at all, every painted box solid black.
  const doc = await open(bytes.slice());
  const canvas = document.createElement('canvas');
  let boxes = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      if ((await page.getTextContent()).items.some(i => 'str' in i && i.str.trim())) throw new UserError('保存した PDF に文字のデータが残っています。');
      const list = painted.get(p) ?? [];
      if (list.length) {
        const scale = capScale(pages[p - 1], 2, LIMITS.checkPixels);
        await renderTo(page, scale, canvas);
        const result = checkBlack(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height), list, scale);
        if (!result.ok) throw new UserError(`${p} ページ目に塗り残しがあります。`, `worst ${result.worst}`);
        boxes += list.length;
      }
      page.cleanup();
      progress(p, doc.numPages);
    }
  } finally { canvas.width = canvas.height = 1; await doc.loadingTask.destroy(); }
  return ['文字のデータ・注釈・作成者などの情報は残っていません', `塗った所（文字ごと ${boxes} か所）はすべて黒くなっています`];
}

export async function loadPdf(file: File): Promise<RedactableDoc> {
  const doc = await open(new Uint8Array(await file.arrayBuffer()));
  try {
    if (doc.numPages > LIMITS.pages) throw new UserError(`ページ数が多すぎます（${LIMITS.pages} ページまで）。`);
    const pages: PageSize[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const v = (await doc.getPage(p)).getViewport({ scale: 1 });
      pages.push({ width: v.width, height: v.height });
    }
    const charCache = new Map<number, Promise<CharBox[]>>();
    const chars = (p: number) => {
      if (!charCache.has(p)) {
        const pending = doc.getPage(p).then(pageChars);
        pending.catch(() => charCache.delete(p));
        charCache.set(p, pending);
      }
      return charCache.get(p)!;
    };
    return {
      kind: 'pdf', name: file.name, pages, chars,
      render: async (p, scale, canvas, signal) => renderTo(await doc.getPage(p), capScale(pages[p - 1], scale, LIMITS.displayPixels), canvas, signal),
      save: (marks, progress) => savePdf(doc, file.name, pages, chars, marks, progress),
      close: () => { void doc.loadingTask.destroy(); },
    };
  } catch (error) { void doc.loadingTask.destroy(); throw error; }
}
