// Small stroke icons (1.75px), drawn inline so nothing is fetched.
type P = { size?: number };
const base = (size = 18) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const Undo = ({ size }: P) => <svg {...base(size)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;
export const Redo = ({ size }: P) => <svg {...base(size)}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>;
export const Eye = ({ size }: P) => <svg {...base(size)}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
export const Download = ({ size }: P) => <svg {...base(size)}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
export const Upload = ({ size }: P) => <svg {...base(size)}><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>;
export const Close = ({ size }: P) => <svg {...base(size)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Minus = ({ size }: P) => <svg {...base(size)}><path d="M5 12h14" /></svg>;
export const Plus = ({ size }: P) => <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>;
export const Fit = ({ size }: P) => <svg {...base(size)}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
export const Lock = ({ size }: P) => <svg {...base(size)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
export const Check = ({ size }: P) => <svg {...base(size)}><path d="m5 12 5 5L20 7" /></svg>;
export const Trash = ({ size }: P) => <svg {...base(size)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
