// Per-visitor wall layout. Falls through to a 501 when KV is not configured, which
// the client treats as "use localStorage" rather than as an error.

import { kv } from '@vercel/kv';

const configured = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const visitorOf = (req) => {
  const raw = req.headers['x-visitor'];
  if (typeof raw !== 'string') return null;
  // Visitor ids are client-generated, so constrain them before they reach a key.
  const clean = raw.replace(/[^a-z0-9]/gi, '').slice(0, 48);
  return clean.length >= 8 ? clean : null;
};

export default async function handler(req, res) {
  if (!configured()) return res.status(501).json({ error: 'kv not configured' });

  const visitor = visitorOf(req);
  if (!visitor) return res.status(400).json({ error: 'bad visitor id' });

  const key = `wall:layout:${visitor}`;

  if (req.method === 'GET') {
    const layout = await kv.get(key);
    return res.status(200).json({ layout: layout ?? {} });
  }

  if (req.method === 'POST') {
    const { layout } = req.body ?? {};
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      return res.status(400).json({ error: 'layout must be an object' });
    }
    // Bound the payload: a visitor cannot move more pieces than exist.
    if (Object.keys(layout).length > 500) {
      return res.status(413).json({ error: 'layout too large' });
    }
    await kv.set(key, layout, { ex: 60 * 60 * 24 * 365 });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('allow', 'GET, POST');
  return res.status(405).end();
}
