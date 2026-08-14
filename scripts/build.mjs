import sharp from 'sharp';
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const SRC = process.argv[2] ?? 'source';
const OUT = process.argv[3] ?? 'public/art';

const SIZES = { final: 1440, flat: 1000, edge: 1000, cutout: 700, thumb: 72 };

// Palette quantisation rather than per-channel banding. Banding each channel
// independently shifts hue badly — brown hair goes olive, pink paper goes yellow —
// because the channels cross their thresholds at different points. A palette keeps
// the artist's actual colours and just removes the shading between them.
const FLAT_COLOURS = 10;

// Sobel magnitude below this is incidental texture rather than linework. Tuned
// against the real art: paper grain and soft airbrush gradients sit well under it,
// inked contours sit well over.
const EDGE_THRESHOLD = 70;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function flatMap(input) {
  const png = await sharp(input)
    .resize(SIZES.flat, SIZES.flat, { fit: 'inside', withoutEnlargement: true })
    .median(3)
    .png({ palette: true, colours: FLAT_COLOURS, dither: 0, effort: 7 })
    .toBuffer();
  return sharp(png).webp({ quality: 84 }).toBuffer();
}

// Sobel over the flat map, not the original. Shading gradients in the original
// produce phantom contours through the middle of a cheek; the quantised version
// only has edges where the artist put them.
async function edgeMap(flatBuf) {
  const { data, info } = await sharp(flatBuf)
    .resize(SIZES.edge, SIZES.edge, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  const out = Buffer.alloc(w * h, 255);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1], tc = data[i - w], tr = data[i - w + 1];
      const ml = data[i - 1], mr = data[i + 1];
      const bl = data[i + w - 1], bc = data[i + w], br = data[i + w + 1];

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.sqrt(gx * gx + gy * gy);

      // Retain magnitude so heavy contours stay darker than incidental detail —
      // a flat black threshold reads as a stencil rather than a drawing.
      if (mag > EDGE_THRESHOLD) out[i] = Math.max(0, 255 - Math.min(255, mag));
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 1 } })
    .webp({ quality: 86 })
    .toBuffer();
}

// The art already ships with white sticker borders, so a sticker is the piece
// trimmed to its content bounds.
async function cutout(input) {
  try {
    return await sharp(input)
      .trim({ threshold: 14 })
      .resize(SIZES.cutout, SIZES.cutout, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    // trim throws when the image is edge-to-edge with no uniform border.
    return sharp(input)
      .resize(SIZES.cutout, SIZES.cutout, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();
  }
}

async function dominant(input) {
  const { dominant: d } = await sharp(input).stats();
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(d.r)}${hex(d.g)}${hex(d.b)}`;
}

async function buildSheet(srcPath, id, outDir, { layers = 'full' } = {}) {
  const raw = await readFile(srcPath);
  const dir = join(outDir, id);
  await mkdir(dir, { recursive: true });

  const meta = await sharp(raw).metadata();

  const finalBuf = await sharp(raw)
    .resize(SIZES.final, SIZES.final, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();
  await writeFile(join(dir, 'final.webp'), finalBuf);

  const thumbBuf = await sharp(raw)
    .resize(SIZES.thumb, SIZES.thumb, { fit: 'inside' })
    .webp({ quality: 72 })
    .toBuffer();
  await writeFile(join(dir, 'thumb.webp'), thumbBuf);

  const out = {
    width: meta.width,
    height: meta.height,
    aspect: +(meta.width / meta.height).toFixed(4),
    dominant: await dominant(raw),
    layers: {
      final: `art/${id}/final.webp`,
      thumb: `art/${id}/thumb.webp`,
    },
  };

  if (layers === 'full') {
    const flatBuf = await flatMap(raw);
    const edgeBuf = await edgeMap(flatBuf);
    const cutBuf = await cutout(raw);
    await Promise.all([
      writeFile(join(dir, 'flat.webp'), flatBuf),
      writeFile(join(dir, 'edge.webp'), edgeBuf),
      writeFile(join(dir, 'cutout.webp'), cutBuf),
    ]);
    Object.assign(out.layers, {
      flat: `art/${id}/flat.webp`,
      edge: `art/${id}/edge.webp`,
      cutout: `art/${id}/cutout.webp`,
    });
  }

  return out;
}

async function loadMeta() {
  const path = join(SRC, 'meta.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.warn(`  meta.json unparseable, ignoring: ${err.message}`);
    return {};
  }
}

async function imagesIn(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
}

// A static, crawlable catalogue. This is what search engines and screen readers
// get, and what the wall falls back to when WebGL-free canvas work is not an
// option — so it is generated at build time rather than rendered on the client.
async function writeListPage(pieces, dest) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const rows = pieces.map((p) => {
    const date = p.posted
      ? new Date(p.posted).toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })
      : '';
    const meta = [esc(p.label), date, p.stack.length ? `${p.stack.length + 1} sheets` : '']
      .filter(Boolean).join(' &middot; ');
    return `    <li>
      <img src="${p.layers.final}" alt="${esc(p.title)}" loading="lazy" width="${p.width}" height="${p.height}">
      <h2>${esc(p.title)}</h2>
      ${meta ? `<p>${meta}</p>` : ''}
    </li>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>medi — every piece</title>
<meta name="description" content="Every illustration by medi, as a plain list.">
<style>
  body { margin:0 auto; padding:32px 20px 64px; max-width:760px; background:#f4f1e8; color:#2a2723;
         font:16px/1.6 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:22px; font-weight:500; margin:0 0 4px; }
  .lede { color:#6a655c; margin:0 0 32px; }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:48px; }
  img { width:100%; height:auto; border-radius:2px; box-shadow:0 2px 10px rgba(0,0,0,.14); }
  h2 { font-size:16px; font-weight:500; margin:14px 0 2px; }
  li p { margin:0; color:#6a655c; font-size:14px; }
  a { color:#8a4a2a; }
</style>
</head>
<body>
<h1>medi</h1>
<p class="lede">${pieces.length} pieces. <a href="index.html">the wall</a> is the same work, but you can throw it around.</p>
<ul>
${rows}
</ul>
</body>
</html>
`;
  await writeFile(dest, html);
}

async function main() {
  // A deploy may ship prebuilt art instead of the source images. Treat that as
  // success rather than failing the build — the alternative is a CI failure on a
  // repo that is in a perfectly valid state.
  if (!existsSync(SRC)) {
    if (existsSync(join(OUT, 'manifest.json'))) {
      console.log(`no ${SRC}/ — using the prebuilt art already in ${OUT}/`);
      return;
    }
    console.error(`source not found: ${SRC}`);
    console.error('either commit source/ so this can build, or commit a prebuilt public/art/');
    console.error('to generate source/ locally: npm run ingest');
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const meta = await loadMeta();
  const files = await imagesIn(SRC);
  const parents = files.filter((f) => !meta[f]?.child);

  console.log(`building ${parents.length} pieces from ${files.length} sheets`);

  const pieces = [];
  for (const file of parents) {
    const id = basename(file, extname(file)).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const m = meta[file] ?? {};
    const t = Date.now();

    try {
      const primary = await buildSheet(join(SRC, file), id, OUT);

      // Album sheets get final + thumb only. They are never the resting face of a
      // piece, so nothing ever scrubs or stickers them, and generating their edge
      // maps would roughly triple build time for layers nobody can reach.
      const stack = [];
      for (const [i, child] of (m.stack ?? []).entries()) {
        if (!existsSync(join(SRC, child))) continue;
        const childId = `${id}--${i + 2}`;
        stack.push(await buildSheet(join(SRC, child), childId, OUT, { layers: 'light' }));
      }

      const wipDir = join(SRC, 'wips', id);
      const wipFiles = await imagesIn(wipDir);
      const wips = [];
      for (const [i, w] of wipFiles.entries()) {
        const wipId = `${id}--wip-${i + 1}`;
        wips.push(await buildSheet(join(wipDir, w), wipId, OUT, { layers: 'light' }));
      }

      // Timelapses live in source/video/ but must be served from the build output,
      // or every piece back 404s in production. Copy rather than reference.
      let timelapse = null;
      if (m.timelapse) {
        const from = join(SRC, m.timelapse);
        if (existsSync(from)) {
          await mkdir(join(OUT, 'video'), { recursive: true });
          const name = basename(m.timelapse);
          await copyFile(from, join(OUT, 'video', name));
          timelapse = `art/video/${name}`;
        } else {
          console.warn(`  ${id}: timelapse missing at ${from}`);
        }
      }

      pieces.push({
        id,
        title: m.title || id,
        label: m.label || '',
        posted: m.posted ?? null,
        shortcode: m.shortcode ?? null,
        timelapse,
        // Optional, written by scripts/tag-eyes.mjs. Absent means no eye tracking.
        eyes: m.eyes ?? null,
        // Real WIP files win over the synthesised un-render when present.
        realWip: wips.length > 0,
        wips,
        stack,
        ...primary,
      });
      console.log(`  ${id}${stack.length ? ` (+${stack.length})` : ''} ${Date.now() - t}ms`);
    } catch (err) {
      console.error(`  ${file} FAILED: ${err.message}`);
    }
  }

  // Margin material: loose doodles and annotations that fill the gaps between
  // finished pieces. Thumbnails only — they are decoration, never openable.
  const margin = [];
  for (const [i, f] of (await imagesIn(join(SRC, 'margin'))).entries()) {
    const id = `margin-${String(i + 1).padStart(2, '0')}`;
    try {
      const built = await buildSheet(join(SRC, 'margin', f), id, OUT, { layers: 'light' });
      margin.push({ id, ...built });
    } catch (err) {
      console.error(`  margin ${f} FAILED: ${err.message}`);
    }
  }

  pieces.sort((a, b) => String(a.posted).localeCompare(String(b.posted)));

  const manifest = {
    generated: new Date().toISOString(),
    count: pieces.length,
    pieces,
    margin,
  };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest));
  await writeListPage(pieces, join(OUT, '..', 'list.html'));

  const withDates = pieces.filter((p) => p.posted).length;
  console.log(`\n${pieces.length} pieces, ${margin.length} margin, ${withDates} dated`);
  console.log(`wrote ${OUT}/manifest.json`);
}

main();
