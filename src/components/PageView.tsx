import { useEffect, useMemo, useRef, useState } from 'react';
import type { RedactableDoc } from '../lib/doc';
import { clampBox, covered, normalize, type Box, type CharBox, type Mark } from '../lib/geometry';
import { Close } from './icons';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; from: { x: number; y: number }; box: Box }
  | { kind: 'move'; id: string; from: { x: number; y: number }; orig: Box; box: Box }
  | { kind: 'resize'; id: string; corner: Corner; orig: Box; box: Box };

const MIN = 3; // smallest box in document units

export interface PageViewProps {
  doc: RedactableDoc;
  page: number; // 1-based
  scale: number; // CSS px per document unit
  marks: Mark[];
  selected: string | null;
  preview: boolean;
  onAdd(box: Box): void;
  onUpdate(id: string, box: Box): void;
  onSelect(id: string | null): void;
  onRemove(id: string): void;
}

export function PageView({ doc, page, scale, marks, selected, preview, onAdd, onUpdate, onSelect, onRemove }: PageViewProps) {
  const size = doc.pages[page - 1];
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [chars, setChars] = useState<CharBox[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Draw the page sharply for the current zoom, but only near the viewport.
  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement('canvas');
      try {
        await doc.render(page, scale * dpr, off);
        if (cancelled || !canvas.current) return;
        const c = canvas.current;
        c.width = off.width; c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        setRendering(false);
      } catch { /* page failed to draw; the box editor still works */ }
      finally { off.width = off.height = 1; }
    }, 60);
    return () => { cancelled = true; clearTimeout(t); };
  }, [visible, scale, doc, page]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void doc.chars(page).then(c => { if (live) setChars(c); });
    return () => { live = false; };
  }, [visible, doc, page]);

  const point = (e: React.PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(size.width, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(size.height, (e.clientY - r.top) / scale)) };
  };

  const shown = useMemo(() => marks.map(m => drag && 'id' in drag && drag.id === m.id ? { ...m, ...drag.box } : m), [marks, drag]);
  const boxes: Box[] = useMemo(() => [...shown, ...(drag?.kind === 'draw' ? [drag.box] : [])], [shown, drag]);
  const red = useMemo(() => preview ? [] : chars.filter(c => covered(c, boxes)), [chars, boxes, preview]);

  const down = (e: React.PointerEvent) => {
    if (preview || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const id = target.closest<HTMLElement>('[data-mark]')?.dataset.mark;
    const corner = target.dataset.corner as Corner | undefined;
    if (target.closest('[data-remove]')) return;
    overlay.current!.setPointerCapture(e.pointerId);
    const p = point(e);
    if (id) {
      const m = marks.find(x => x.id === id)!;
      onSelect(id);
      setDrag(corner ? { kind: 'resize', id, corner, orig: m, box: m } : { kind: 'move', id, from: p, orig: m, box: m });
    } else {
      onSelect(null);
      setDrag({ kind: 'draw', from: p, box: { x: p.x, y: p.y, w: 0, h: 0 } });
    }
    e.preventDefault();
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = point(e);
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
  const up = () => {
    if (!drag) return;
    const b = clampBox(drag.box, size.width, size.height);
    const big = b.w >= MIN && b.h >= MIN && b.w * scale >= 5 && b.h * scale >= 5;
    if (drag.kind === 'draw') { if (big) onAdd(b); }
    else if (big && (b.x !== drag.orig.x || b.y !== drag.orig.y || b.w !== drag.orig.w || b.h !== drag.orig.h)) onUpdate(drag.id, b);
    setDrag(null);
  };

  const px = (b: Box) => ({ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });
  return (
    <section className="page" ref={holder} aria-label={`${page} ページ目`}>
      <div className="sheet" style={{ width: size.width * scale, height: size.height * scale }}>
        <canvas ref={canvas} className="sheet-canvas" style={{ width: size.width * scale, height: size.height * scale }} />
        {rendering && <div className="sheet-loading" />}
        <div ref={overlay} className={`overlay${preview ? ' is-preview' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {red.map((c, i) => <div key={i} className="gone" style={px(c)} />)}
          {shown.map(m => (
            <div key={m.id} data-mark={m.id} className={`mark${m.id === selected ? ' is-selected' : ''}`} style={px(m)}>
              {m.id === selected && !preview && <>
                {(['nw', 'ne', 'sw', 'se'] as Corner[]).map(c => <span key={c} data-corner={c} className={`handle ${c}`} />)}
                <button type="button" data-remove className="remove" aria-label="この塗りを外す" onClick={() => onRemove(m.id)}><Close size={14} /></button>
              </>}
            </div>
          ))}
          {drag?.kind === 'draw' && <div className="mark is-draft" style={px(drag.box)} />}
        </div>
      </div>
      <div className="page-no">{page} / {doc.pages.length}</div>
    </section>
  );
}
