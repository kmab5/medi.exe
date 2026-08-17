// Password check for the dashboard login screen. Returns 200 only when the key is
// correct, so the client can gate its UI without needing to attempt a real write
// first. Carries no data and grants nothing — every other endpoint checks the same
// header independently, so a forged "logged in" state in the browser buys nothing.

import { guard } from './_auth.js';
import { configured as githubReady } from './_github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).end();
  }
  if (!guard(req, res, {})) return;

  return res.status(200).json({
    ok: true,
    // Surfaced so the dashboard can say what is wrong up front rather than failing
    // on the first save.
    github: githubReady(),
  });
}
