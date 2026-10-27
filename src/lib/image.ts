import type { Mark } from './geometry';
import { outputName, type RedactableDoc } from './doc';

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像に変換できませんでした')), type, quality));

/** Images are decoded with their EXIF orientation applied and re-encoded from
 * pixels, so the output carries no EXIF, GPS or other metadata. */
export async function loadImage(file: File): Promise<RedactableDoc> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const width = bitmap.width, height = bitmap.height;
  const png = file.type === 'image/png' || /\.png$/iu.test(file.name);
  return {
    kind: 'image', name: file.name, pages: [{ width, height }],
    render: async (_page, scale, canvas) => {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    },
    chars: async () => [],
    save: async (marks: readonly Mark[], progress) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      ctx.fillStyle = '#000';
      for (const m of marks) {
        const x0 = Math.floor(m.x), y0 = Math.floor(m.y);
        ctx.fillRect(x0, y0, Math.ceil(m.x + m.w) - x0, Math.ceil(m.y + m.h) - y0);
      }
      const blob = await toBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.95);
      canvas.width = canvas.height = 1;
      progress?.(1, 1);
      // Check the saved pixels, not the canvas we drew on.
      const check = await createImageBitmap(blob);
      const c2 = document.createElement('canvas');
      c2.width = check.width; c2.height = check.height;
      const ctx2 = c2.getContext('2d')!;
      ctx2.drawImage(check, 0, 0);
      const ok = marks.every(m => {
        const px = ctx2.getImageData(Math.floor(m.x + m.w / 2), Math.floor(m.y + m.h / 2), 1, 1).data;
        return px[0] < 40 && px[1] < 40 && px[2] < 40;
      });
      c2.width = c2.height = 1;
      if (!ok) throw new Error('保存した画像で塗れていない所があります');
      return { blob, name: outputName(file.name, png ? 'png' : 'jpg'),
        checks: ['撮影日時や位置などの情報は消しました', `${marks.length} か所すべて黒く塗られています`] };
    },
    close: () => bitmap.close(),
  };
}
