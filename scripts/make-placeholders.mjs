import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'source';
const N = Number(process.argv[3] ?? 8);

const PALETTES = [
  ['#f3d9e0', '#c9526f', '#3b2430', '#f7efe6'],
  ['#d6e8e4', '#2f8f7c', '#1d3b36', '#fbf7ee'],
  ['#e3ddf5', '#6b5bc4', '#2a2350', '#f6f3fb'],
  ['#fbe6cf', '#d9822b', '#4a2b10', '#fdf6ec'],
  ['#dbe7f5', '#3b6ea8', '#16283f', '#f2f6fb'],
];

// A stand-in for a cutout figure: soft shaded blob, white sticker border, a couple
// of interior contours so edge detection has something real to find.
function svg(i, w, h) {
  const p = PALETTES[i % PALETTES.length];
  const cx = w / 2;
  const headR = w * 0.19;
  const headY = h * 0.3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="sh" cx="38%" cy="30%">
      <stop offset="0%" stop-color="${p[0]}"/>
      <stop offset="100%" stop-color="${p[1]}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${p[3]}"/>
  <g stroke="#ffffff" stroke-width="${w * 0.035}" fill="none">
    <circle cx="${cx}" cy="${headY}" r="${headR}"/>
    <path d="M${cx - headR * 1.5} ${h * 0.92} q0 ${-h * 0.34} ${headR * 1.5} ${-h * 0.34} q${headR * 1.5} 0 ${headR * 1.5} ${h * 0.34} z"/>
  </g>
  <circle cx="${cx}" cy="${headY}" r="${headR}" fill="url(#sh)"/>
  <path d="M${cx - headR * 1.5} ${h * 0.92} q0 ${-h * 0.34} ${headR * 1.5} ${-h * 0.34} q${headR * 1.5} 0 ${headR * 1.5} ${h * 0.34} z" fill="url(#sh)"/>
  <g fill="${p[2]}">
    <ellipse cx="${cx - headR * 0.42}" cy="${headY - headR * 0.1}" rx="${headR * 0.13}" ry="${headR * 0.18}"/>
    <ellipse cx="${cx + headR * 0.42}" cy="${headY - headR * 0.1}" rx="${headR * 0.13}" ry="${headR * 0.18}"/>
  </g>
  <path d="M${cx - headR * 0.3} ${headY + headR * 0.4} q${headR * 0.3} ${headR * 0.25} ${headR * 0.6} 0"
        stroke="${p[2]}" stroke-width="${w * 0.009}" fill="none" stroke-linecap="round"/>
  <path d="M${cx - headR} ${h * 0.66} h${headR * 2}" stroke="${p[2]}" stroke-width="${w * 0.007}" opacity="0.5"/>
  <path d="M${cx - headR * 0.7} ${h * 0.75} h${headR * 1.4}" stroke="${p[2]}" stroke-width="${w * 0.007}" opacity="0.5"/>
  <text x="${w * 0.06}" y="${h * 0.09}" font-family="serif" font-size="${w * 0.05}" fill="${p[2]}" opacity="0.55">placeholder ${i + 1}</text>
</svg>`;
}

await mkdir(OUT, { recursive: true });
const meta = {};

for (let i = 0; i < N; i++) {
  const w = 900 + (i % 3) * 180;
  const h = 1100 + (i % 4) * 140;
  const name = `piece-${String(i + 1).padStart(2, '0')}.png`;
  await sharp(Buffer.from(svg(i, w, h))).png().toFile(join(OUT, name));
  meta[name] = {
    title: `placeholder ${i + 1}`,
    label: 'stand-in until the real export lands',
  };
}

await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`wrote ${N} placeholder pieces to ${OUT}/`);
