// Read and rewrite content/notes.json from the medi-login portal.
//
// The file is the single source for both the notes pinned to the wall and the
// notes page, so a save here changes both. Writing commits to the repo, which
// triggers a rebuild.
//
// Validation happens on the server as well as in the browser. The client is a
// convenience; this endpoint is the actual boundary, and it is holding a token with
// write access to the repository.

import { commitFiles, readJsonFile, configured } from './_github.js';
import { guard } from './_auth.js';

const MAX_NOTES = 24;
const MAX_TITLE = 120;
const MAX_PARAGRAPH = 2000;
const MAX_PARAGRAPHS = 20;
const MAX_LINKS = 6;
const KINDS = new Set(['note', 'index', 'sticky', 'receipt']);

const PATH = 'content/notes.json';

const slug = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

function validate(notes) {
  if (!Array.isArray(notes)) return { error: 'notes must be a list' };
  if (notes.length > MAX_NOTES) return { error: `too many notes (max ${MAX_NOTES})` };

  const seen = new Set();
  const clean = [];

  for (const [i, raw] of notes.entries()) {
    if (!raw || typeof raw !== 'object') return { error: `note ${i + 1} is not an object` };

    const title = String(raw.title ?? '').trim();
    if (!title) return { error: `note ${i + 1} needs a title` };
    if (title.length > MAX_TITLE) return { error: `note ${i + 1}: title too long` };

    // An id is derived from the title when absent, because the layout keys off it
    // and a note without one silently vanishes from the wall.
    const id = slug(raw.id) || slug(title) || `note-${i + 1}`;
    if (seen.has(id)) return { error: `two notes share the id "${id}" — give one a different title` };
    seen.add(id);

    const kind = KINDS.has(raw.kind) ? raw.kind : 'note';

    const body = (Array.isArray(raw.body) ? raw.body : [])
      .map((p) => String(p ?? '').trim())
      .filter(Boolean);
    if (body.length > MAX_PARAGRAPHS) return { error: `note ${i + 1}: too many paragraphs` };
    if (body.some((p) => p.length > MAX_PARAGRAPH)) {
      return { error: `note ${i + 1}: a paragraph is too long` };
    }

    const links = [];
    for (const l of Array.isArray(raw.links) ? raw.links : []) {
      const label = String(l?.label ?? '').trim().slice(0, 80);
      const href = String(l?.href ?? '').trim();
      if (!label || !href) continue;
      // Only http(s) and mailto. A javascript: href here would be rendered into
      // both the wall and the notes page.
      if (!/^(https?:\/\/|mailto:)/i.test(href)) {
        return { error: `note ${i + 1}: link "${label}" must start with http, https or mailto` };
      }
      links.push({ label, href: href.slice(0, 400) });
    }
    if (links.length > MAX_LINKS) return { error: `note ${i + 1}: too many links` };

    clean.push({ id, kind, title, body, ...(links.length ? { links } : {}) });
  }

  return { notes: clean };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).end();
  }

  if (!guard(req, res, { githubConfigured: configured() })) return;

  try {
    if (req.method === 'GET') {
      const file = await readJsonFile(PATH);
      return res.status(200).json({ notes: file?.notes ?? [] });
    }

    const { notes } = req.body ?? {};
    const result = validate(notes);
    if (result.error) return res.status(400).json({ error: result.error });

    // Preserve any keys the editor does not know about, so a future field added by
    // hand is not silently dropped by a save from the portal.
    const existing = (await readJsonFile(PATH)) ?? {};
    const next = { ...existing, notes: result.notes };

    const sha = await commitFiles(
      [{ path: PATH, content: `${JSON.stringify(next, null, 2)}\n` }],
      `Edit notes via medi-login (${result.notes.length} notes)`,
    );

    return res.status(200).json({ ok: true, commit: sha, count: result.notes.length });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: String(err.message).slice(0, 400) });
  }
}
