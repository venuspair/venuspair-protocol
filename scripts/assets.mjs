// Derives web assets from the brand logo. Source: brand/LOGO VENUSPAIR PNG...png
// (IHDR colourtype 6, 8-bit RGBA; ~72% fully transparent pixels whose stored RGB is pure black).
// Resizes are done on premultiplied pixels so the black under alpha 0 never bleeds into edges.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'brand', 'LOGO VENUSPAIR PNG...png');
const out = path.join(root, 'src', 'assets');
fs.mkdirSync(out, { recursive: true });

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

// crop to the planet bounding box (opaque pixels), with a small margin
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (data[(y * W + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
}
const side = Math.max(x1 - x0, y1 - y0) + 1;
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
const crop = { left: Math.max(0, cx - (side >> 1) - 4), top: Math.max(0, cy - (side >> 1) - 4), width: side + 8, height: side + 8 };
console.log('planet bbox', x0, y0, x1, y1, 'crop', crop);

function premultiply(buf) {
  const o = Buffer.from(buf);
  for (let i = 0; i < o.length; i += 4) { const a = o[i + 3] / 255; o[i] = Math.round(o[i] * a); o[i + 1] = Math.round(o[i + 1] * a); o[i + 2] = Math.round(o[i + 2] * a); }
  return o;
}
const cropped = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract(crop).raw().toBuffer({ resolveWithObject: true });
const pm = premultiply(cropped.data);
const base = () => sharp(pm, { raw: { width: cropped.info.width, height: cropped.info.height, channels: 4, premultiplied: true } });

for (const size of [1024, 512, 128]) {
  await base().resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(out, `planet-${size}.webp`));
}

// social card: planet on pure black (the logo's own background value)
const planet = await base().resize(560, 560).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .composite([{ input: planet, left: 320, top: 35 }]).jpeg({ quality: 88 }).toFile(path.join(out, 'og.jpg'));

// favicon: 32x32 grid sampled from the premultiplied resize, circle mask via alpha, colours snapped to real logo pixels
const small = await base().resize(32, 32, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer();
// k-means (k=16, seed 11) cluster centres snapped to real pixel coordinates of the logo PNG
const PAL = ['#a9b4c0','#ccbfb4','#d6d7d8','#2c3f55','#70849a','#092545','#b8a89c','#546c86','#8d9cae','#e4e7eb','#385471','#c3c8cf','#595e66','#807773','#123c64','#9e9087'];
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = (r, g, b) => {
  let best = PAL[0], bd = 1e9;
  for (const p of PAL) { const [pr, pg, pb] = rgb(p); const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
};
const px = (i) => { const a = small[i + 3] / 255; const u = v => Math.min(255, Math.round(v / a)); return hex(u(small[i]), u(small[i + 1]), u(small[i + 2])); };
const rects = [];
for (let y = 0; y < 32; y++) {
  let x = 0;
  while (x < 32) {
    const i = (y * 32 + x) * 4;
    if (small[i + 3] < 128) { x++; continue; }
    const c = px(i);
    let n = 1;
    while (x + n < 32 && small[(y * 32 + x + n) * 4 + 3] >= 128 && px((y * 32 + x + n) * 4) === c) n++;
    rects.push('<rect x="' + x + '" y="' + y + '" width="' + n + '" height="1" fill="' + c + '"/>');
    x += n;
  }
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">' + rects.join('') + '</svg>\n';
fs.writeFileSync(path.join(out, 'favicon.svg'), svg);
console.log('favicon rects', rects.length, 'bytes', svg.length);
