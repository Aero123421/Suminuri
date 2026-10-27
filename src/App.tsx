import { useEffect, useRef, useState } from 'react';
import { UserError, type RedactableDoc } from './lib/doc';
import { Editor } from './components/Editor';
import { Start } from './components/Start';

async function load(file: File): Promise<RedactableDoc> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return (await import('./lib/pdf')).loadPdf(file);
  if (/^image\/(png|jpeg)$/u.test(file.type) || /\.(png|jpe?g)$/u.test(name)) return (await import('./lib/image')).loadImage(file);
  throw new UserError('PDF・PNG・JPEG のファイルを選んでください（Excel・Word は準備中です）。');
}

export function App() {
  const [open, setOpen] = useState<{ doc: RedactableDoc; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  // Only the latest request may open; an older, slower load is closed when it arrives.
  const generation = useRef(0);

  const openFile = async (file: File) => {
    const mine = ++generation.current;
    setBusy(true); setError(undefined);
    try {
      const doc = await load(file);
      if (mine !== generation.current) { doc.close(); return; }
      setOpen(prev => { prev?.doc.close(); return { doc, key: mine }; });
    } catch (e) {
      if (mine === generation.current) setError(e instanceof UserError ? e.message : 'ファイルを開けませんでした。');
    } finally { if (mine === generation.current) setBusy(false); }
  };

  // Accept a drop anywhere on the start screen.
  useEffect(() => {
    if (open) return;
    const over = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files[0]; if (f) void openFile(f); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  if (open) return <Editor key={open.key} doc={open.doc} onClose={() => { generation.current++; open.doc.close(); setOpen(null); }} />;
  return <>
    <Start onFile={f => void openFile(f)} busy={busy} error={error} />
    {dragging && <div className="drop-veil" aria-hidden="true"><span>ここで離すと開きます</span></div>}
  </>;
}
