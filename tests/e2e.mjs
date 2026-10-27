// End-to-end check of the real app in Chromium, with the saved files checked
// independently of the app (Poppler for PDFs, a small PNG decoder for images).
// Usage: npm run build && npm run preview -- --port 4180 &  then  node tests/e2e.mjs [baseURL]
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://127.0.0.1:4180/';
const fixtures = path.resolve('tests/fixtures');
const out = path.resolve('test-results'); mkdirSync(out, { recursive: true });

// ---------- independent decoders ----------
function readPpm(file) {
  const buf = readFileSync(file);
  let pos = 0; const fields = [];
  while (fields.length < 4) {
    while (/\s/u.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; continue; }
    let s = ''; while (!/\s/u.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
    fields.push(s);
  }
  pos++;
  assert.equal(fields[0], 'P6');
  return { width: +fields[1], height: +fields[2], channels: 3, data: buf.subarray(pos) };
}
function readPng(file) {
  const buf = readFileSync(file);
  let pos = 8, width = 0, height = 0, type = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8); type = body[9]; assert.equal(body[12], 0, 'interlaced PNG'); }
    if (kind === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : assert.fail(`PNG colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels] : 0, b = y ? data[(y - 1) * stride + x] : 0, c = x >= channels && y ? data[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      data[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { width, height, channels, data };
}
function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (kind, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(kind), body]))); return Buffer.concat([len, Buffer.from(kind), body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0FICTIONAL SECRET COMMENT')), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
/** Share of opaque, near-black pixels inside a box given in image pixels. */
function darkShare(img, b) {
  let total = 0, dark = 0;
  for (let y = Math.ceil(b.y); y < Math.floor(b.y + b.h); y++) for (let x = Math.ceil(b.x); x < Math.floor(b.x + b.w); x++) {
    const i = (y * img.width + x) * img.channels;
    total++;
    if ((img.channels < 4 || img.data[i + 3] === 255) && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) < 64) dark++;
  }
  return total ? dark / total : 1;
}
const inset = (b, d) => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });

// ---------- browser ----------
function chromePath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = path.join(homedir(), '.cache/ms-playwright');
  for (const dir of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    const exe = path.join(root, dir, 'chrome-linux64/chrome');
    if (existsSync(exe)) return exe;
  }
}
// UTF-8 locale so Chromium keeps Japanese download names (the C locale turns them into "download").
const browser = await chromium.launch({ executablePath: chromePath(), env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const origin = new URL(base).origin, external = [], errors = [];
page.on('request', r => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== origin) external.push(r.url()); });
page.on('pageerror', e => errors.push(String(e)));

async function openFile(file) {
  await page.goto(base);
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('.page .overlay:not(.is-waiting)', { timeout: 30_000 });
}
async function drag(from, to) {
  const box = await page.locator('.page .overlay').first().boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
/** Red character rectangles, in CSS px relative to the page. */
const redRects = () => page.$$eval('.gone', els => {
  const o = els[0]?.parentElement.getBoundingClientRect();
  return els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }; });
});
async function save(shot) {
  await page.screenshot({ path: path.join(out, `${shot}-edit.png`) });
  const download = page.waitForEvent('download', { timeout: 180_000 });
  await page.click('button.primary');
  const toast = await page.waitForSelector('.toast', { timeout: 180_000 });
  const text = await toast.innerText();
  if (text.startsWith('保存できませんでした')) throw new Error(`save failed: ${text}`);
  const d = await download;
  const saved = path.join(out, `${shot}-${d.suggestedFilename()}`);
  await d.saveAs(saved);
  return { saved, name: d.suggestedFilename(), toast: text, cssWidth: await page.locator('.sheet').first().evaluate(e => e.getBoundingClientRect().width) };
}
async function checkPdf(saved, rects, cssWidth, ptWidth, tag) {
  assert.equal(execFileSync('pdftotext', [saved, '-']).toString().trim(), '', 'no text layer');
  const info = execFileSync('pdfinfo', [saved]).toString();
  assert.doesNotMatch(info, /^(Author|Creator|Producer|Title|Subject|Keywords):/mu, 'no document info');
  const doc = await PDFDocument.load(readFileSync(saved), { updateMetadata: false });
  assert.deepEqual(doc.catalog.keys().map(k => k.decodeText()).sort(), ['Pages', 'Type']);
  const prefix = path.join(out, `check-${tag}`);
  execFileSync('pdftoppm', ['-r', '144', '-f', '1', '-l', '1', saved, prefix]);
  const img = readPpm(readdirSync(out).filter(f => f.startsWith(`check-${tag}-`) && f.endsWith('.ppm')).map(f => path.join(out, f))[0]);
  const k = 2 / (cssWidth / ptWidth); // CSS px → 144 dpi pixels
  return rects.map(r => darkShare(img, inset({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }, 1.5)));
}

const results = {};
const contract = path.join(fixtures, 'contract.pdf');
const ptWidth = Number(/Page size:\s+([\d.]+)/u.exec(execFileSync('pdfinfo', [contract]).toString())[1]);

// A. Box around a company name: its 10 characters turn red, and all of them are black in the file.
await openFile(contract);
await drag([74, 244], [242, 270]);
const redA = await redRects();
assert.equal(redA.length, 10, '株式会社青空架空企画 = 10 characters');
const a = await save('pdf-full');
assert.equal(a.name, 'contract_墨塗り.pdf');
assert.match(a.toast, /文字のデータ・注釈・作成者などの情報は残っていません/);
const shareA = await checkPdf(a.saved, redA, a.cssWidth, ptWidth, 'full');
assert.ok(shareA.every(s => s >= 0.99), `every red character is black: ${shareA}`);
results.full = { red: redA.length, minDark: Math.min(...shareA) };

// B. A sliver over the left part of the first character: that character turns red and is erased whole.
await openFile(contract);
await drag([77, 247], [83, 266]);
const redB = await redRects();
assert.equal(redB.length, 1, 'only the first character');
const b = await save('pdf-partial');
const shareB = await checkPdf(b.saved, redB, b.cssWidth, ptWidth, 'partial');
assert.ok(shareB[0] >= 0.99, `partly covered character is black: ${shareB}`);
results.partial = { red: redB.length, dark: shareB[0] };

// C. Transparent PNG with a text chunk: the box becomes opaque black, the chunk disappears.
const clear = path.join(out, 'transparent.png');
writePng(clear, 400, 300, (x, y) => x >= 100 && x < 300 && y >= 100 && y < 200 ? [220, 30, 30, 255] : [0, 0, 0, 0]);
await openFile(clear);
const css = await page.locator('.sheet').first().evaluate(e => e.getBoundingClientRect().width);
const s = css / 400;
await drag([90 * s, 90 * s], [310 * s, 210 * s]);
const c = await save('png-transparent');
assert.equal(c.name, 'transparent_墨塗り.png');
assert.doesNotMatch(readFileSync(c.saved).toString('latin1'), /FICTIONAL SECRET|tEXt|eXIf|iTXt/u);
const png = readPng(c.saved);
assert.equal(darkShare(png, { x: 100, y: 100, w: 200, h: 100 }), 1, 'opaque black over the red square');
results.png = { dark: 1 };

// D. Business card photo.
await openFile(path.join(fixtures, 'card.png'));
await drag([40, 40], [260, 120]);
const d = await save('card');
assert.equal(d.name, 'card_墨塗り.png');
assert.match(d.toast, /黒くなっています/);

assert.deepEqual(external, [], 'no request may leave the page origin');
assert.deepEqual(errors, []);
writeFileSync(path.join(out, 'e2e.json'), JSON.stringify(results, null, 2));
console.log('E2E PASS', JSON.stringify(results));
await browser.close();
