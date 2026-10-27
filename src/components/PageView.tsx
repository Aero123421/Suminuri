import { useEffect, useMemo, useRef, useState } from 'react';
import type { RedactableDoc } from '../lib/doc';
import { clampBox, coveredChars, normalize, padChar, type Box, type CharBox, type Mark } from '../lib/geometry';
import { Close } from './icons';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; from: { x: number; y: number }; box: Box }
  | { kind: 'move'; id: string; from: { x: number; y: number }; orig: Box; box: Box }
  | { kind: 'resize'; id: string; corner: Corner; orig: Box; box: Box };

const MIN = 3; // smallest box in document units
const HOLD_MS = 280; // touch: hold this long to start drawing; a quick swipe scrolls

export interface PageViewProps {
  doc: RedactableDoc;
  page: number; // 1-based
  scale: number; // CSS px per document unit
  marks: Mark[];
  selected: string | null;
  preview: boolean;
  locked: boolean;
  onAdd(box: Box): void;
  onUpdate(id: string, box: Box): void;
  onSelect(id: string | null): void;
  onRemove(id: string): void;
}

export function PageView({ doc, page, scale, marks, selected, preview, locked, onAdd, onUpdate, onSelect, onRemove }: PageViewProps) {
  const size = doc.pages[page - 1];
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [chars, setChars] = useState<CharBox[]>([]);
  const [charsFailed, setCharsFailed] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const pointer = useRef<number | null>(null);
  const armed = useRef(false); // touch drawing armed after a hold
  const hold = useRef<{ timer: number; x: number; y: number; e: { clientX: number; clientY: number } } | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Draw the page sharply for the current zoom, only near the viewport; free it when far away.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!visible) { c.width = c.height = 0; setStatus('loading'); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement('canvas');
      try {
        await doc.render(page, scale * dpr, off, controller.signal);
        if (controller.signal.aborted) return;
        c.width = off.width; c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        setStatus('ready');
      } catch { if (!controller.signal.aborted) setStatus('error'); }
      finally { off.width = off.height = 1; }
    }, 60);
    return () => { controller.abort(); clearTimeout(t); };
  }, [visible, scale, doc, page, attempt]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    doc.chars(page).then(c => { if (live) { setChars(c); setCharsFailed(false); } }, () => { if (live) setCharsFailed(true); });
    return () => { live = false; };
  }, [visible, doc, page]);

  // A touch drag scrolls the page unless the finger was held first (then it draws).
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (armed.current) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(size.width, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(size.height, (e.clientY - r.top) / scale)) };
  };

  const shown = useMemo(() => marks.map(m => drag && 'id' in drag && drag.id === m.id ? { ...m, ...drag.box } : m), [marks, drag]);
  const boxes: Box[] = useMemo(() => [...shown, ...(drag?.kind === 'draw' ? [drag.box] : [])], [shown, drag]);
  const red = useMemo(() => coveredChars(chars, boxes), [chars, boxes]);

  const begin = (e: { clientX: number; clientY: number }, target: HTMLElement) => {
    const id = target.closest<HTMLElement>('[data-mark]')?.dataset.mark;
    const corner = target.dataset.corner as Corner | undefined;
    const p = toDoc(e);
    if (id) {
      const m = marks.find(x => x.id === id)!;
      onSelect(id);
      setDrag(corner ? { kind: 'resize', id, corner, orig: m, box: m } : { kind: 'move', id, from: p, orig: m, box: m });
    } else {
      onSelect(null);
      setDrag({ kind: 'draw', from: p, box: { x: p.x, y: p.y, w: 0, h: 0 } });
    }
  };

  const down = (e: React.PointerEvent) => {
    if (preview || locked || e.button !== 0 || pointer.current !== null) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-remove]')) return;
    if (e.pointerType === 'touch' && !target.closest('[data-mark]')) {
      // Wait: a hold starts drawing, moving first lets the browser scroll.
      const start = { clientX: e.clientX, clientY: e.clientY };
      const id = e.pointerId;
      hold.current = { x: e.clientX, y: e.clientY, e: start, timer: window.setTimeout(() => {
        hold.current = null; armed.current = true; pointer.current = id;
        overlay.current?.setPointerCapture(id);
        begin(start, target);
        navigator.vibrate?.(10);
      }, HOLD_MS) };
      return;
    }
    pointer.current = e.pointerId;
    overlay.current!.setPointerCapture(e.pointerId);
    begin(e, target);
    e.preventDefault();
  };
  const move = (e: React.PointerEvent) => {
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) { clearTimeout(hold.current.timer); hold.current = null; }
    if (!drag || e.pointerId !== pointer.current) return;
    const p = toDoc(e);
    if (drag.kind === 'draw') setDrag({ ...drag, box: normalize(drag.from, p) });
    else if (drag.kind === 'move') {
      const dx = Math.max(-drag.orig.x, Math.min(size.width - drag.orig.x - drag.orig.w, p.x - drag.from.x));
      const dy = Math.max(-drag.orig.y, Math.min(size.height - drag.orig.y - drag.orig.h, p.y - drag.from.y));
      setDrag({ ...drag, box: { ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy } });
    } else {
      const o = drag.orig;
      const fixed = { x: drag.corner.includes('w') ? o.x + o.w : o.x, y: drag.corner.includes('n') ? o.y + o.h : o.y };
      setDrag({ ...drag, box: normalize(fixed, p) });
    }
  };
  const finish = (e: React.PointerEvent, commit: boolean) => {
    if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; }
    if (e.pointerId !== pointer.current) return;
    pointer.current = null; armed.current = false;
    if (!drag) return;
    const b = clampBox(drag.box, size.width, size.height);
    const big = b.w >= MIN && b.h >= MIN && b.w * scale >= 5 && b.h * scale >= 5;
    if (commit && big) {
      if (drag.kind === 'draw') onAdd(b);
      else if (b.x !== drag.orig.x || b.y !== drag.orig.y || b.w !== drag.orig.w || b.h !== drag.orig.h) onUpdate(drag.id, b);
    }
    setDrag(null);
  };

  const px = (b: Box) => ({ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });
  return (
    <section className="page" ref={holder} aria-label={`${page} ページ目`}>
      <div className="sheet" style={{ width: size.width * scale, height: size.height * scale }}>
        <canvas ref={canvas} className="sheet-canvas" style={{ width: size.width * scale, height: size.height * scale }} />
        {status === 'loading' && <div className="sheet-loading" />}
        {status === 'error' && (
          <div className="sheet-error" role="alert">
            <p>このページを表示できませんでした</p>
            <button type="button" className="toggle" onClick={() => { setStatus('loading'); setAttempt(a => a + 1); }}>もう一度</button>
          </div>
        )}
        <div ref={overlay} data-chars={chars.length} className={`overlay${preview ? ' is-preview' : ''}${status !== 'ready' ? ' is-waiting' : ''}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={e => finish(e, true)} onPointerCancel={e => finish(e, false)}>
          {/* What saving paints: in preview the covered characters turn black too. */}
          {red.map((c, i) => <div key={i} className={preview ? 'gone-final' : 'gone'} style={px(preview ? padChar(c) : c)} />)}
          {shown.map((m, i) => (
            <div key={m.id} data-mark={m.id} className={`mark${m.id === selected ? ' is-selected' : ''}`} style={px(m)}
              tabIndex={preview ? -1 : 0} role="button" aria-label={`塗り ${i + 1}（${page} ページ目）`} onFocus={() => !preview && onSelect(m.id)}>
              {m.id === selected && !preview && !locked && <>
                {(['nw', 'ne', 'sw', 'se'] as Corner[]).map(c => <span key={c} data-corner={c} className={`handle ${c}`} />)}
                <button type="button" data-remove className={`remove${m.y * scale < 40 ? ' below' : ''}`} aria-label="この塗りを外す" onClick={() => onRemove(m.id)}><Close size={14} /></button>
              </>}
            </div>
          ))}
          {drag?.kind === 'draw' && <div className="mark is-draft" style={px(drag.box)} />}
        </div>
      </div>
      <div className="page-no">{page} / {doc.pages.length}{charsFailed && doc.kind === 'pdf' && <span className="page-warn">・文字の位置を読み取れませんでした（四角の中は塗られます）</span>}</div>
    </section>
  );
}
