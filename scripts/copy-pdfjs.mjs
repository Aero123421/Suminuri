// Copy PDF.js runtime data (CMaps, standard fonts, wasm decoders) next to the app,
// so the browser loads them from the same origin and never from a CDN.
import { cp, mkdir } from 'node:fs/promises';
const from = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const to = new URL('../public/pdfjs/', import.meta.url);
await mkdir(to, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(new URL(dir + '/', from), new URL(dir + '/', to), { recursive: true });
console.log('pdf.js data copied to public/pdfjs/');
