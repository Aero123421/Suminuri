import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { RedactableDoc, SaveResult } from '../lib/doc';
import { newId, type Box, type Mark } from '../lib/geometry';
import { PageView } from './PageView';
import { Check, Close, Download, Eye, Fit, Minus, Plus, Redo, Undo } from './icons';

interface History { past: Mark[][]; now: Mark[]; future: Mark[][] }
type Action = { type: 'set'; marks: Mark[] } | { type: 'undo' } | { type: 'redo' };
function history(state: History, action: Action): History {
  if (action.type === 'set') return { past: [...state.past, state.now].slice(-200), now: action.marks, future: [] };
  if (action.type === 'undo') return state.past.length ? { past: state.past.slice(0, -1), now: state.past.at(-1)!, future: [state.now, ...state.future] } : state;
  return state.future.length ? { past: [...state.past, state.now], now: state.future[0], future: state.future.slice(1) } : state;
}

const HINT_KEY = 'suminuri.hint.v1';
function hintSeen(): boolean { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } }
function hideHint(): void { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ } }

type Toast = { kind: 'ok'; title: string; lines: string[] } | { kind: 'error'; title: string; lines: string[] };

export function Editor({ doc, onClose }: { doc: RedactableDoc; onClose(): void }) {
  const [state, dispatch] = useReducer(history, { past: [], now: [], future: [] });
  const marks = state.now;
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [hint, setHint] = useState(!hintSeen());
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Fit the widest page to the window width.
  useEffect(() => {
    const measure = () => {
      const w = scroller.current?.clientWidth ?? window.innerWidth;
      const widest = Math.max(...doc.pages.map(p => p.width));
      setFit(Math.max(0.1, Math.min(w - 48, 980) / widest));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [doc]);
  const scale = fit * zoom;

  const set = useCallback((next: Mark[]) => dispatch({ type: 'set', marks: next }), []);
  const add = (page: number, box: Box) => set([...marks, { ...box, page, id: newId() }]);
  const update = (id: string, box: Box) => set(marks.map(m => m.id === id ? { ...m, ...box } : m));
  const remove = useCallback((id: string) => { set(marks.filter(m => m.id !== id)); setSelected(null); }, [marks, set]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); setSelected(null); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); }
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, remove]);

  const save = async () => {
    if (!marks.length || saving) return;
    setSelected(null);
    setSaving({ done: 0, total: doc.pages.length });
    try {
      const result: SaveResult = await doc.save(marks, (done, total) => setSaving({ done, total }));
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url; a.download = result.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setToast({ kind: 'ok', title: `保存しました：${result.name}`, lines: result.checks });
    } catch (error) {
      setToast({ kind: 'error', title: '保存できませんでした', lines: [error instanceof Error ? error.message : String(error)] });
    } finally { setSaving(null); }
  };

  const close = () => {
    if (marks.length && !window.confirm('塗った内容は保存されていません。閉じますか？')) return;
    onClose();
  };

  return (
    <div className="editor">
      <header className="bar">
        <button type="button" className="brand small" onClick={close} title="最初の画面に戻る"><span className="brand-mark" aria-hidden="true" />Suminuri</button>
        <span className="file" title={doc.name}>{doc.name}</span>
        <div className="bar-tools">
          <span className="count" aria-live="polite">{marks.length ? `${marks.length} か所` : '未選択'}</span>
          <button type="button" className="icon" onClick={() => { dispatch({ type: 'undo' }); setSelected(null); }} disabled={!state.past.length} title="元に戻す（Ctrl+Z）" aria-label="元に戻す"><Undo /></button>
          <button type="button" className="icon" onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} title="やり直す（Ctrl+Shift+Z）" aria-label="やり直す"><Redo /></button>
          <button type="button" className={`toggle${preview ? ' on' : ''}`} onClick={() => { setPreview(p => !p); setSelected(null); }} aria-pressed={preview} title="保存したときの見た目"><Eye />仕上がり</button>
          <button type="button" className="primary" onClick={save} disabled={!marks.length || !!saving}><Download />保存</button>
          <button type="button" className="icon" onClick={close} title="閉じる" aria-label="閉じる"><Close /></button>
        </div>
      </header>
      {hint && (
        <div className="hint" role="note">
          <span><b>ドラッグして四角く囲む</b>と、その部分が黒く塗られます。{doc.kind === 'pdf' && <><span className="hint-red">赤くなった文字</span>は、保存すると消える文字です。</>}</span>
          <button type="button" className="icon" aria-label="閉じる" onClick={() => { setHint(false); hideHint(); }}><Close size={16} /></button>
        </div>
      )}
      <div className="pages" ref={scroller} onPointerDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
        {doc.pages.map((_, i) => (
          <PageView key={i} doc={doc} page={i + 1} scale={scale} preview={preview} selected={selected}
            marks={marks.filter(m => m.page === i + 1)}
            onAdd={b => add(i + 1, b)} onUpdate={update} onSelect={setSelected} onRemove={remove} />
        ))}
        {doc.kind === 'pdf' && <p className="foot-note">保存すると、PDF は各ページを画像にした新しい PDF になります。塗った所の文字は、見た目も文字のデータも残りません。</p>}
      </div>
      <div className="zoom" role="group" aria-label="表示の大きさ">
        <button type="button" className="icon" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))} aria-label="小さく"><Minus size={16} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon" onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(2)))} aria-label="大きく"><Plus size={16} /></button>
        <button type="button" className="icon" onClick={() => setZoom(1)} aria-label="幅に合わせる" title="幅に合わせる"><Fit size={16} /></button>
      </div>
      {saving && (
        <div className="modal" role="status">
          <div className="modal-card">
            <div className="spinner" aria-hidden="true" />
            <p>書き出しています… {saving.total > 1 ? `${saving.done} / ${saving.total} ページ` : ''}</p>
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <div>
            <p className="toast-title">{toast.kind === 'ok' && <Check size={16} />}{toast.title}</p>
            {toast.lines.map(l => <p key={l} className="toast-line">{l}</p>)}
          </div>
          <button type="button" className="icon" aria-label="閉じる" onClick={() => setToast(null)}><Close size={16} /></button>
        </div>
      )}
    </div>
  );
}
