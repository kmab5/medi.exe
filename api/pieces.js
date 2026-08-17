// Lists everything in source/meta.json and toggles what the wall displays.
//
// Hiding does not delete. The image stays in the repository and the flag stays in
// meta.json, so a piece can come back with one click — which matters, because this
// dashboard is the only interface and an irreversible delete button next to a
// visibility toggle is an accident waiting to happen.

import { commitFiles, readJsonFile, configured } from './_github.js';
import { guard } from './_auth.js';

const PATH = 'source/meta.json';
const MAX_UPDATES = 500;

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).end();
  }

  if (!guard(req, res, { githubConfigured: configured() })) return;

  try {
    if (req.method === 'GET') {
      const meta = (await readJsonFile(PATH)) ?? {};
      // Children are album pages, not pieces in their own right, so the dashboard
      // never lists them separately.
      const pieces = Object.entries(meta)
        .filter(([, m]) => m && !m.child)
        .map(([file, m]) => ({
          file,
          id: file.replace(/\.[^.]+$/, '').toLowerCase(),
          title: m.title || '',
          label: m.label || '',
          posted: m.posted ?? null,
          sheets: 1 + (m.stack?.length ?? 0),
          hasVideo: Boolean(m.timelapse),
          hidden: Boolean(m.hidden),
        }))
        .sort((a, b) => String(b.posted).localeCompare(String(a.posted)));

      return res.status(200).json({ pieces });
    }

    // Shape is checked before anything reaches the network. Reading meta.json first
    // would turn a malformed request into a 502 from GitHub rather than the 400 it
    // actually is.
    const { updates } = req.body ?? {};
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an object of file → hidden' });
    }
    const entries = Object.entries(updates);
    if (entries.length > MAX_UPDATES) {
      return res.status(413).json({ error: 'too many updates' });
    }
    for (const [file, hidden] of entries) {
      if (typeof hidden !== 'boolean') {
        return res.status(400).json({ error: `${file}: hidden must be true or false` });
      }
    }
    if (!entries.length) return res.status(200).json({ ok: true, changed: 0, commit: null });

    const meta = (await readJsonFile(PATH)) ?? {};

    let changed = 0;
    for (const [file, hidden] of entries) {
      // Only touch files that already exist in meta.json. Accepting arbitrary keys
      // would let a malformed request write junk into the manifest source.
      if (!meta[file] || meta[file].child) {
        return res.status(400).json({ error: `unknown piece: ${file}` });
      }
      if (Boolean(meta[file].hidden) === hidden) continue;
      if (hidden) meta[file].hidden = true;
      else delete meta[file].hidden;
      changed++;
    }

    if (!changed) return res.status(200).json({ ok: true, changed: 0, commit: null });

    const sha = await commitFiles(
      [{ path: PATH, content: `${JSON.stringify(meta, null, 2)}\n` }],
      `Update what the wall shows (${changed} changed)`,
    );

    return res.status(200).json({ ok: true, changed, commit: sha });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: String(err.message).slice(0, 400) });
  }
}
