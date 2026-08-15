// Upload endpoint for /medi-login.
//
// Two actions. `blob` stages one file and returns its sha; `commit` takes those
// shas, updates source/meta.json, and writes everything in a single commit. That
// commit triggers a Vercel rebuild, which runs the pipeline and the new piece
// appears on the wall.
//
// Authentication is a single shared password in MEDI_PASSWORD. That is proportionate
// for a one-person publishing tool, but it is the only thing standing between the
// internet and write access to the repo, so it is compared in constant time and the
// endpoint refuses to run at all if the password is unset or trivially short.

import { timingSafeEqual } from 'node:crypto';
import { createBlob, commitFiles, readJsonFile, configured } from './_github.js';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SHEETS = 12;
const MIN_PASSWORD = 12;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

function authorised(req) {
  const expected = process.env.MEDI_PASSWORD;
  if (!expected || expected.length < MIN_PASSWORD) return false;

  const given = req.headers['x-medi-key'];
  if (typeof given !== 'string') return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const slug = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

function decodeBase64(data) {
  if (typeof data !== 'string') return null;
  // Accept both a bare base64 string and a data: URL.
  const bare = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(bare)) return null;
  const buf = Buffer.from(bare, 'base64');
  return buf.length ? { base64: bare.replace(/\s/g, ''), bytes: buf.length } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).end();
  }
  if (!configured()) {
    return res.status(501).json({ error: 'github not configured — set GITHUB_TOKEN and GITHUB_REPO' });
  }
  if (!process.env.MEDI_PASSWORD || process.env.MEDI_PASSWORD.length < MIN_PASSWORD) {
    return res.status(503).json({ error: `set MEDI_PASSWORD to at least ${MIN_PASSWORD} characters` });
  }
  if (!authorised(req)) {
    // Deliberately vague, and identical for a wrong password and a missing one.
    return res.status(401).json({ error: 'nope' });
  }

  const { action } = req.body ?? {};

  try {
    if (action === 'blob') {
      const { data, type } = req.body;
      if (!IMAGE_TYPES.has(type) && !VIDEO_TYPES.has(type)) {
        return res.status(415).json({ error: `unsupported type: ${type}` });
      }
      const decoded = decodeBase64(data);
      if (!decoded) return res.status(400).json({ error: 'bad file data' });
      if (decoded.bytes > MAX_BYTES) {
        return res.status(413).json({
          error: `file is ${(decoded.bytes / 1048576).toFixed(1)}MB, limit is ${MAX_BYTES / 1048576}MB`,
        });
      }
      const sha = await createBlob(decoded.base64);
      return res.status(200).json({ sha, bytes: decoded.bytes });
    }

    if (action === 'commit') {
      const { title, label, sheets, video, posterSha } = req.body;

      if (!Array.isArray(sheets) || sheets.length === 0) {
        return res.status(400).json({ error: 'need at least one sheet' });
      }
      if (sheets.length > MAX_SHEETS) {
        return res.status(400).json({ error: `too many sheets (max ${MAX_SHEETS})` });
      }
      if (!sheets.every((s) => typeof s?.sha === 'string' && /^[0-9a-f]{40}$/.test(s.sha))) {
        return res.status(400).json({ error: 'bad sheet sha' });
      }

      const id = slug(title) || `piece-${Date.now().toString(36)}`;
      const files = [];
      const names = [];

      // A video piece uploads a poster frame extracted in the browser; that poster
      // becomes the still on the wall and the video goes on the back.
      const primarySha = video ? posterSha : sheets[0].sha;
      if (video && !/^[0-9a-f]{40}$/.test(String(posterSha))) {
        return res.status(400).json({ error: 'video upload needs a poster frame' });
      }

      files.push({ path: `source/${id}.jpg`, sha: primarySha });
      names.push(`${id}.jpg`);

      const extras = video ? sheets : sheets.slice(1);
      extras.forEach((s, i) => {
        if (video && i === 0) return;
        const name = `${id}--${i + 2}.jpg`;
        files.push({ path: `source/${name}`, sha: s.sha });
        names.push(name);
      });

      let timelapse = null;
      if (video) {
        if (!/^[0-9a-f]{40}$/.test(String(video.sha))) {
          return res.status(400).json({ error: 'bad video sha' });
        }
        timelapse = `video/${id}.mp4`;
        files.push({ path: `source/${timelapse}`, sha: video.sha });
      }

      const meta = (await readJsonFile('source/meta.json')) ?? {};
      if (meta[names[0]]) {
        return res.status(409).json({ error: `a piece called ${id} already exists` });
      }

      meta[names[0]] = {
        shortcode: null,
        posted: new Date().toISOString(),
        stack: names.slice(1),
        timelapse,
        // No ffmpeg in this environment, so an uploaded video has no small preview
        // clip. The full video stands in until someone runs ingest locally.
        preview: timelapse,
        title: String(title ?? '').slice(0, 120),
        label: String(label ?? '').slice(0, 400),
      };
      for (const n of names.slice(1)) meta[n] = { child: true };

      files.push({ path: 'source/meta.json', content: JSON.stringify(meta, null, 2) });

      const sha = await commitFiles(files, `Add ${id} via medi-login`);
      return res.status(200).json({ ok: true, id, commit: sha, files: files.length });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: String(err.message).slice(0, 400) });
  }
}
