import { useRef } from 'react';
import { Lock, Upload } from './icons';

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

export function Start({ onFile, busy, error }: { onFile: (f: File) => void; busy: boolean; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <main className="start">
      <div className="start-inner">
        <div className="brand"><span className="brand-mark" aria-hidden="true" />Suminuri</div>
        <h1>隠したい所を、四角で囲むだけ。</h1>
        <button type="button" className="drop" onClick={() => input.current?.click()} disabled={busy}>
          <span className="drop-icon"><Upload size={26} /></span>
          <span className="drop-title">{busy ? '開いています…' : 'ファイルをここにドロップ'}</span>
          <span className="drop-sub">またはクリックして選ぶ ・ PDF / PNG / JPEG</span>
        </button>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        {error && <p className="error" role="alert">{error}</p>}
        <ol className="how">
          <li><b>1</b>ファイルを開く</li>
          <li><b>2</b>ドラッグで四角く囲む</li>
          <li><b>3</b>保存する</li>
        </ol>
        <p className="privacy"><Lock size={15} />ファイルはこの端末の外に送られません</p>
      </div>
    </main>
  );
}
