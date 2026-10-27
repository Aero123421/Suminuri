// End-to-end check of the real app in Chromium: open → draw a box → red characters
// appear → save → the saved file is checked by the app itself. Also asserts that the
// page makes no request outside its own origin.
// Usage: node tests/e2e.mjs [baseURL] (default http://127.0.0.1:4180/, run `npm run preview -- --port 4180` first)
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://127.0.0.1:4180/';
const fixtures = path.resolve('tests/fixtures');
const out = path.resolve('test-results'); mkdirSync(out, { recursive: true });

function chromePath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = path.join(homedir(), '.cache/ms-playwright');
  for (const dir of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    const exe = path.join(root, dir, 'chrome-linux64/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

// UTF-8 locale so Chromium keeps Japanese download names (the C locale turns them into "download").
const browser = await chromium.launch({ executablePath: chromePath(), env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const origin = new URL(base).origin;
const external = [];
page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

async function drag(selector, from, to) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

async function run(file, draw, shot) {
  await page.goto(base);
  await page.setInputFiles('input[type=file]', path.join(fixtures, file));
  await page.waitForSelector('.page .overlay');
  await page.waitForFunction(() => !document.querySelector('.sheet-loading'), null, { timeout: 30_000 });
  for (const [from, to] of draw) await drag('.page .overlay', from, to);
  await page.waitForTimeout(300);
  const marks = await page.locator('.mark:not(.is-draft)').count();
  const red = await page.locator('.gone').count();
  await page.screenshot({ path: path.join(out, `${shot}-edit.png`) });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('button.primary')]);
  const saved = path.join(out, download.suggestedFilename());
  await download.saveAs(saved);
  await page.waitForSelector('.toast');
  const toast = await page.locator('.toast').innerText();
  await page.screenshot({ path: path.join(out, `${shot}-saved.png`) });
  return { marks, red, toast, saved, name: download.suggestedFilename() };
}

const results = {};
const pdf = await run('contract.pdf', [[[74, 244], [242, 270]]], 'pdf');
assert.equal(pdf.marks, 1);
assert.ok(pdf.red > 5, `red characters expected, got ${pdf.red}`);
assert.match(pdf.toast, /文字のデータは残っていません/);
assert.equal(pdf.name, 'contract_墨塗り.pdf');
results.pdf = pdf;

const img = await run('card.png', [[[40, 40], [260, 120]]], 'image');
assert.equal(img.marks, 1);
assert.match(img.toast, /黒く塗られています/);
assert.equal(img.name, 'card_墨塗り.png');
results.image = img;

assert.deepEqual(external, [], 'no request may leave the page origin');
assert.deepEqual(errors, []);
writeFileSync(path.join(out, 'e2e.json'), JSON.stringify(results, null, 2));
console.log('E2E PASS', JSON.stringify({ pdf: { marks: pdf.marks, red: pdf.red }, image: { marks: img.marks } }));
await browser.close();
