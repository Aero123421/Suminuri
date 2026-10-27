import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { UserError, type RedactableDoc, type SaveResult } from '../lib/doc';
import { newId, type Box, type Mark } from '../lib/geometry';
import { PageView } from './PageView';
import { Check, Close, Download, Eye, Fit, Minus, Plus, Redo, Trash, Undo } from './icons';

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

type Toast = { kind: 'ok' | 'error'; title: string; lines: string[] };
const EMPTY: Mark[] = [];

export function Editor({ doc, onClose }: { doc: RedactableDoc; onClose(): void }) {
  const [state, dispatch] = useReducer(history, { past: [], now: EMPTY, future: [] });
  const marks = state.now;
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [hint, setHint] = useState(!hintSeen());
  const [saving, setSaving] = useState<{ done: number; total: number; phase: 'write' | 'check' } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [savedMarks, setSavedMarks] = useState<Mark[]>(EMPTY); // what the last saved file contains
  const scroller = useRef<HTMLDivElement>(null);
  const dirty = marks !== savedMarks && marks.length > 0;
  const locked = saving !== null;

  // Fit the widest page to the window width.
  useEffect(() => {
    const measure = () => {
      const w = scroller.current?.clientWidth ?? window.innerWidth;
      const widest = Math.max(...doc.pages.map(p => p.width));
      setFit(Math.max(0.05, Math.min(w - 48, 980) / widest));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [doc]);
  const scale = fit * zoom;

  // Warn before the tab is closed with unsaved boxes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = useCallback((next: Mark[]) => dispatch({ type: 'set', marks: next }), []);
  const add = (page: number, box: Box) => set([...marks, { ...box, page, id: newId() }]);
  const update = (id: string, box: Box) => set(marks.map(m => m.id === id ? { ...m, ...box } : m));
  const remove = useCallback((id: string) => { set(marks.filter(m => m.id !== id)); setSelected(null); }, [marks, set]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (locked || (e.target as HTMLElement)?.closest('input, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); setSelected(null); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); }
      else if (e.key === 'Escape') setSelected(null);
      else if (selected && e.key.startsWith('Arrow')) {
        // Arrows move the selected box; with Alt they change its size. Shift = bigger steps.
        e.preventDefault();
        const m = marks.find(x => x.id === selected);
        if (!m) return;
        const step = (e.shiftKey ? 10 : 1) / Math.max(scale, 0.01) * 2;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const p = doc.pages[m.page - 1];
        const next = e.altKey ? { ...m, w: Math.max(3, Math.min(p.width - m.x, m.w + dx)), h: Math.max(3, Math.min(p.height - m.y, m.h + dy)) }
          : { ...m, x: Math.max(0, Math.min(p.width - m.w, m.x + dx)), y: Math.max(0, Math.min(p.height - m.h, m.y + dy)) };
        update(m.id, next);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const save = async () => {
    if (!marks.length || saving) return;
    setSelected(null); setToast(null);
    setSaving({ done: 0, total: doc.pages.length, phase: 'write' });
    const snapshot = marks;
    try {
      const result: SaveResult = await doc.save(snapshot, (done, total, phase) => setSaving({ done, total, phase }));
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url; a.download = result.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSavedMarks(snapshot);
      setToast({ kind: 'ok', title: `保存しました：${result.name}`, lines: result.checks });
    } catch (error) {
      console.error('save failed', error, (error as UserError)?.detail ?? '');
      const message = error instanceof UserError ? error.message : '保存できませんでした。';
      setToast({ kind: 'error', title: '保存できませんでした', lines: [message] });
    } finally { setSaving(null); }
  };

  const close = () => {
    if (locked) return;
    if (dirty && !window.confirm('保存していない塗りがあります。閉じますか？')) return;
    onClose();
  };

  const selectedMark = marks.find(m => m.id === selected);
  return (
    <div className="editor" aria-busy={locked}>
      <header className="bar">
        <button type="button" className="brand small" onClick={close} title="最初の画面に戻る"><span className="brand-mark" aria-hidden="true" />Suminuri</button>
        <span className="file" title={doc.name}>{doc.name}</span>
        <div className="bar-tools">
          <span className="count" aria-live="polite">{marks.length ? `${marks.length} か所` : ''}</span>
          {selectedMark && !preview && <button type="button" className="icon" onClick={() => remove(selectedMark.id)} title="選んだ塗りを外す（Delete）" aria-label="選んだ塗りを外す"><Trash /></button>}
          <button type="button" className="icon" onClick={() => { dispatch({ type: 'undo' }); setSelected(null); }} disabled={!state.past.length || locked} title="元に戻す（Ctrl+Z）" aria-label="元に戻す"><Undo /></button>
          <button type="button" className="icon" onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length || locked} title="やり直す（Ctrl+Shift+Z）" aria-label="やり直す"><Redo /></button>
          <button type="button" className={`toggle${preview ? ' on' : ''}`} onClick={() => { setPreview(p => !p); setSelected(null); }} aria-pressed={preview} disabled={locked} title="保存したときの見た目"><Eye />仕上がり</button>
          <button type="button" className="primary" onClick={save} disabled={!marks.length || locked}><Download />保存</button>
          <button type="button" className="icon" onClick={close} disabled={locked} title="閉じる" aria-label="閉じる"><Close /></button>
        </div>
      </header>
      {hint && (
        <div className="hint" role="note">
          <span><b>ドラッグして四角く囲む</b>と、その部分が黒く塗られます。{doc.kind === 'pdf' && <><span className="hint-red">赤くなった文字</span>は、文字ごと黒く塗られます。</>}</span>
          <button type="button" className="icon" aria-label="閉じる" onClick={() => { setHint(false); hideHint(); }}><Close size={16} /></button>
        </div>
      )}
      <div className={`pages${preview ? ' is-preview' : ''}`} ref={scroller} onPointerDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
        {doc.pages.map((_, i) => (
          <PageView key={i} doc={doc} page={i + 1} scale={scale} preview={preview} locked={locked} selected={selected}
            marks={marks.filter(m => m.page === i + 1)}
            onAdd={b => add(i + 1, b)} onUpdate={update} onSelect={setSelected} onRemove={remove} />
        ))}
        {doc.kind === 'pdf' && <p className="foot-note">保存すると、各ページを画像にした新しい PDF になります。塗った所は見た目も文字のデータも残らず、作成者などの情報も入りません。</p>}
      </div>
      <div className="zoom" role="group" aria-label="表示の大きさ">
        <button type="button" className="icon" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))} aria-label="小さく"><Minus size={16} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon" onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(2)))} aria-label="大きく"><Plus size={16} /></button>
        <button type="button" className="icon" onClick={() => setZoom(1)} aria-label="幅に合わせる" title="幅に合わせる"><Fit size={16} /></button>
      </div>
      {saving && (
        <div className="modal" role="status" aria-live="polite">
          <div className="modal-card">
            <div className="spinner" aria-hidden="true" />
            <p>{saving.phase === 'write' ? '書き出しています' : '保存したファイルを確かめています'}… {saving.total > 1 ? `${saving.done} / ${saving.total} ページ` : ''}</p>
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
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
