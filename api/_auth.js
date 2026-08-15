// Shared password gate for the writing endpoints.
//
// A single shared secret is proportionate for a one-person publishing tool, but it
// is the only thing between the internet and write access to the repository, so it
// is compared in constant time and the endpoints refuse to run at all if it is
// unset or trivially short.

import { timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD = 12;

export const passwordUsable = () => {
  const pw = process.env.MEDI_PASSWORD;
  return Boolean(pw && pw.length >= MIN_PASSWORD);
};

export function authorised(req) {
  if (!passwordUsable()) return false;

  const given = req.headers['x-medi-key'];
  if (typeof given !== 'string') return false;

  const a = Buffer.from(given);
  const b = Buffer.from(process.env.MEDI_PASSWORD);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Every writing endpoint refuses in the same order and with the same wording, so a
// probe cannot tell a wrong password from a missing one.
export function guard(req, res, { githubConfigured } = {}) {
  if (githubConfigured === false) {
    res.status(501).json({ error: 'github not configured — set GITHUB_TOKEN and GITHUB_REPO' });
    return false;
  }
  if (!passwordUsable()) {
    res.status(503).json({ error: `set MEDI_PASSWORD to at least ${MIN_PASSWORD} characters` });
    return false;
  }
  if (!authorised(req)) {
    res.status(401).json({ error: 'nope' });
    return false;
  }
  return true;
}
