// Copy PDF.js runtime data (CMaps, standard fonts, wasm decoders) next to the app,
// so the browser loads them from the same origin and never from a CDN.
import { cp, mkdir, rm } from 'node:fs/promises';
const from = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const to = new URL('../public/pdfjs/', import.meta.url);
await mkdir(to, { recursive: true });
await rm(to, { recursive: true, force: true });
// Liberation fonts are GPL-2.0 (with a font exception); leave them out. PDF.js then
// falls back to the system's sans-serif for non-embedded Arial/Helvetica text.
// quickjs-eval runs JavaScript inside PDFs; this app never does, so it is not shipped either.
const skip = (src) => !/[\\/]LiberationSans-[^\\/]*\.ttf$|LICENSE_LIBERATION$|quickjs-eval/u.test(src);
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(new URL(dir + '/', from), new URL(dir + '/', to), { recursive: true, filter: skip });
console.log('pdf.js data copied to public/pdfjs/');
