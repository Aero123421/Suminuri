import { useEffect, useState } from 'react';
import type { RedactableDoc } from './lib/doc';
import { Editor } from './components/Editor';
import { Start } from './components/Start';

async function load(file: File): Promise<RedactableDoc> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return (await import('./lib/pdf')).loadPdf(file);
  if (/^image\/(png|jpeg)$/u.test(file.type) || /\.(png|jpe?g)$/u.test(name)) return (await import('./lib/image')).loadImage(file);
  throw new Error('PDF・PNG・JPEG のファイルを選んでください（Excel・Word は準備中です）');
}

export function App() {
  const [doc, setDoc] = useState<RedactableDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const open = async (file: File) => {
    setBusy(true); setError(undefined);
    try { const d = await load(file); doc?.close(); setDoc(d); }
    catch (e) { setError(e instanceof Error ? e.message : 'ファイルを開けませんでした'); }
    finally { setBusy(false); }
  };

  // Accept a drop anywhere on the start screen.
  useEffect(() => {
    if (doc) return;
    const over = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files[0]; if (f) void open(f); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  if (doc) return <Editor doc={doc} onClose={() => { doc.close(); setDoc(null); }} />;
  return <>
    <Start onFile={f => void open(f)} busy={busy} error={error} />
    {dragging && <div className="drop-veil" aria-hidden="true"><span>ここで離すと開きます</span></div>}
  </>;
}
