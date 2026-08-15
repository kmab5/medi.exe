import { readdir, mkdir, copyFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SRC = process.argv[2] ?? 'export/tiredmedi';
const OUT = process.argv[3] ?? 'source';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov']);

const PREVIEW_WIDTH = 460;
const PREVIEW_FPS = 12;
const PREVIEW_SECONDS = 8;

// Instagram media IDs are snowflake-style: the top 41 bits are milliseconds since
// the Instagram epoch. Shortcodes are those IDs in a big-endian base64 alphabet.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_EPOCH = 1314220021721n;
const FULL_CODE_LENGTH = 11;

// Calibrated against a known pair: album tiredmedi_C650S9ZC8SX contains media
// 3366952182447926300, which this resolves to 2024-05-13. Truncated codes are
// left-aligned to full width, so the recovered timestamp is accurate to ~30ms —
// the missing characters are low-order bits well below the millisecond field.
function decodeShortcode(code) {
  if (code.length > FULL_CODE_LENGTH) return null;
  let v = 0n;
  for (const ch of code) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    v = (v << 6n) | BigInt(i);
  }
  return v << BigInt(6 * (FULL_CODE_LENGTH - code.length));
}

function postedAt(code) {
  const id = decodeShortcode(code);
  if (id === null) return null;
  const d = new Date(Number((id >> 23n) + IG_EPOCH));
  // Anything outside Instagram's lifetime means the code was malformed.
  if (d.getUTCFullYear() < 2011 || d.getUTCFullYear() > 2100) return null;
  return d.toISOString();
}

// The export uses two conventions:
//   instagram-post-tiredmedi-<code8>-<date>.jpg   single media, truncated code
//   tiredmedi_<code11>/<mediaId>.jpg              album directory, full code
function shortcodeOf(name) {
  const album = name.match(/^tiredmedi_([A-Za-z0-9_-]+)$/);
  if (album) return album[1];
  const single = name.match(/tiredmedi-([A-Za-z0-9_-]+?)-\d{4}-\d{2}-\d{2}/);
  if (single) return single[1];
  return null;
}

// Codes appear at two lengths for the same media, so dedupe on a common prefix.
const dedupeKey = (code) => code.slice(0, 8);

const numericOf = (name) => BigInt(basename(name, extname(name)).replace(/\D/g, '') || '0');

async function entriesOf(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    out.push({ name: e, path: p, dir: (await stat(p)).isDirectory() });
  }
  return out;
}

async function posterFrame(video, dest) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video,
  ]);
  const duration = parseFloat(stdout.trim()) || 1;
  // 40% in: process videos open on a blank canvas and often close on an outro.
  const at = Math.max(0.1, duration * 0.4);
  await run('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(at), '-i', video,
    '-frames:v', '1', '-q:v', '2', dest,
  ]);
}

// A lightweight looping clip for the wall face. Full timelapses are 1–2MB each and
// autoplaying eighteen of them would be indefensible; these come out around a tenth
// of that and still read as motion at wall scale.
//
// Not a GIF. A muted H.264 loop is roughly an order of magnitude smaller than the
// equivalent GIF, keeps full colour instead of 256, and decodes on the GPU.
//
// This lives in ingest rather than build because build runs on Vercel, where there
// is no ffmpeg.
async function previewClip(video, dest) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video,
  ]);
  const duration = parseFloat(stdout.trim()) || 1;
  const start = Math.max(0, Math.min(duration * 0.15, Math.max(0, duration - PREVIEW_SECONDS)));

  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', String(start),
    '-t', String(Math.min(PREVIEW_SECONDS, duration)),
    '-i', video,
    '-an',
    '-vf', `scale=${PREVIEW_WIDTH}:-2:flags=lanczos,fps=${PREVIEW_FPS}`,
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-crf', '31',
    '-movflags', '+faststart',
    dest,
  ]);
}

async function collect(dir, pieces) {
  for (const e of await entriesOf(dir)) {
    if (e.name.includes('profile')) continue;
    const code = shortcodeOf(e.name);
    if (!code) continue;
    const key = dedupeKey(code);

    if (e.dir) {
      // Album. Inner filenames are numeric media IDs, so sorting them numerically
      // restores the artist's intended slide order.
      const files = (await entriesOf(e.path))
        .filter((f) => !f.dir && IMAGE_EXT.has(extname(f.name).toLowerCase()))
        .sort((a, b) => (numericOf(a.name) < numericOf(b.name) ? -1 : 1));
      if (!files.length) continue;
      const prev = pieces.get(key);
      pieces.set(key, { code, sheets: files.map((f) => f.path), video: prev?.video ?? null });
      continue;
    }

    const ext = extname(e.name).toLowerCase();
    const existing = pieces.get(key);

    if (IMAGE_EXT.has(ext)) {
      // A still always beats a video poster frame for the same media.
      if (existing && existing.sheets.length) continue;
      pieces.set(key, { code, sheets: [e.path], video: existing?.video ?? null });
    } else if (VIDEO_EXT.has(ext)) {
      if (existing) existing.video = e.path;
      else pieces.set(key, { code, sheets: [], video: e.path });
    }
  }
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`export not found: ${SRC}`);
    console.error('expected the unzipped export, e.g. export/tiredmedi/');
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  for (const d of ['', 'video', 'wips/_unpaired', 'margin']) {
    await mkdir(join(OUT, d), { recursive: true });
  }

  const pieces = new Map();
  await collect(join(SRC, 'reels'), pieces);
  await collect(join(SRC, 'posts'), pieces);

  const meta = {};
  let sheetCount = 0;
  let videoCount = 0;

  for (const [key, piece] of pieces) {
    const id = key.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const posted = postedAt(piece.code);

    let sheets = piece.sheets;
    if (!sheets.length && piece.video) {
      const poster = join(OUT, `${id}.jpg`);
      await posterFrame(piece.video, poster);
      sheets = [poster];
    }
    if (!sheets.length) continue;

    const names = [];
    for (const [i, src] of sheets.entries()) {
      const name = i === 0 ? `${id}.jpg` : `${id}--${i + 1}.jpg`;
      const dest = join(OUT, name);
      if (src !== dest) await copyFile(src, dest);
      names.push(name);
      sheetCount++;
    }

    let timelapse = null;
    let preview = null;
    if (piece.video) {
      timelapse = `video/${id}${extname(piece.video)}`;
      await copyFile(piece.video, join(OUT, timelapse));
      preview = `video/${id}-preview.mp4`;
      try {
        await previewClip(piece.video, join(OUT, preview));
      } catch (err) {
        console.warn(`  ${id}: preview failed (${err.message}), falling back to the full clip`);
        preview = timelapse;
      }
      videoCount++;
    }

    // Sheets 2..n of an album are children of sheet 1: they share a stack and are
    // never laid out independently on the wall.
    meta[names[0]] = {
      shortcode: piece.code,
      posted,
      stack: names.slice(1),
      timelapse,
      preview,
      title: '',
      label: '',
    };
    for (const n of names.slice(1)) meta[n] = { child: true };
  }

  const wips = (await entriesOf(join(SRC, 'highlights', 'WIP')))
    .filter((f) => !f.dir && IMAGE_EXT.has(extname(f.name).toLowerCase()));
  for (const f of wips) await copyFile(f.path, join(OUT, 'wips', '_unpaired', f.name));

  const doodles = (await entriesOf(join(SRC, 'highlights', 'OP Doodles')))
    .filter((f) => !f.dir && IMAGE_EXT.has(extname(f.name).toLowerCase()));
  for (const f of doodles) await copyFile(f.path, join(OUT, 'margin', f.name));

  await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

  const parents = Object.values(meta).filter((m) => !m.child);
  const dates = parents.map((m) => m.posted).filter(Boolean).sort();

  console.log(`ingested ${parents.length} pieces / ${sheetCount} sheets / ${videoCount} timelapses`);
  console.log(`  dates recovered for ${dates.length} of ${parents.length}`);
  if (dates.length) console.log(`  ${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`);
  console.log(`  ${wips.length} wips -> ${OUT}/wips/_unpaired/`);
  console.log(`  ${doodles.length} doodles -> ${OUT}/margin/`);
  console.log(`\nadd "title" and "label" to entries in ${OUT}/meta.json to name pieces`);
}

main();
