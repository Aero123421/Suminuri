import type { Mark } from './geometry';
import { checkBlack, LIMITS, outputName, UserError, type RedactableDoc } from './doc';

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new UserError('画像を書き出せませんでした（メモリ不足の可能性があります）。')), type, quality));

function release(canvas: HTMLCanvasElement): void { canvas.width = canvas.height = 1; }

/** Images are decoded with their EXIF orientation applied and re-encoded from
 * pixels, so the output carries no EXIF, GPS, text chunks or other metadata. */
export async function loadImage(file: File): Promise<RedactableDoc> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (error) { throw new UserError('画像を読み込めませんでした（PNG・JPEG に対応しています）。', String(error)); }
  const width = bitmap.width, height = bitmap.height;
  if (width * height > LIMITS.imagePixels || Math.max(width, height) > LIMITS.imageSide) {
    bitmap.close();
    throw new UserError(`画像が大きすぎます（${LIMITS.imagePixels / 1_000_000} 百万画素・一辺 ${LIMITS.imageSide} 画素まで）。`);
  }
  const png = file.type === 'image/png' || /\.png$/iu.test(file.name);
  return {
    kind: 'image', name: file.name, pages: [{ width, height }],
    render: async (_page, scale, canvas) => {
      const s = Math.min(scale, Math.sqrt(LIMITS.displayPixels / (width * height)));
      canvas.width = Math.max(1, Math.round(width * s));
      canvas.height = Math.max(1, Math.round(height * s));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    },
    chars: async () => [],
    save: async (marks: readonly Mark[], progress) => {
      const canvas = document.createElement('canvas');
      let blob: Blob;
      try {
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        ctx.fillStyle = '#000';
        for (const m of marks) {
          const x0 = Math.floor(m.x), y0 = Math.floor(m.y);
          // Clear first so a transparent PNG gets opaque black, not translucent paint.
          ctx.clearRect(x0, y0, Math.ceil(m.x + m.w) - x0, Math.ceil(m.y + m.h) - y0);
          ctx.fillRect(x0, y0, Math.ceil(m.x + m.w) - x0, Math.ceil(m.y + m.h) - y0);
        }
        blob = await toBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.95);
      } finally { release(canvas); }
      progress?.(1, 1, 'write');
      // Check the saved file, not the canvas we drew on.
      const check = await createImageBitmap(blob);
      const c2 = document.createElement('canvas');
      try {
        if (check.width !== width || check.height !== height) throw new UserError('保存した画像の大きさが元と違います。');
        c2.width = width; c2.height = height;
        const ctx2 = c2.getContext('2d')!;
        ctx2.drawImage(check, 0, 0);
        const result = checkBlack(ctx2.getImageData(0, 0, width, height), marks, 1);
        if (!result.ok) throw new UserError('保存した画像に塗り残しがあります。', `worst ${result.worst}`);
      } finally { check.close(); release(c2); }
      progress?.(1, 1, 'check');
      return { blob, name: outputName(file.name, png ? 'png' : 'jpg'),
        checks: ['撮影日時・位置・コメントなどの情報は残っていません', `${marks.length} か所すべて黒くなっています`] };
    },
    close: () => bitmap.close(),
  };
}
