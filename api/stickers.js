// The shared sticker layer. Placement-only: the body names one of the artist's own
// cutouts and a position, so there is no user-supplied media to moderate.

import { kv } from '@vercel/kv';

const KEY = 'wall:stickers:shared';
const MAX = 4000;

const configured = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export default async function handler(req, res) {
  if (!configured()) return res.status(501).json({ error: 'kv not configured' });

  if (req.method === 'GET') {
    const stickers = await kv.lrange(KEY, -MAX, -1);
    return res.status(200).json({ stickers: stickers ?? [] });
  }

  if (req.method === 'POST') {
    const { id, x, y, rot } = req.body ?? {};

    // The id must look like a piece id; coordinates must be finite and sane. A
    // sticker that fails validation is dropped rather than clamped, because a
    // malformed one is a client bug worth surfacing.
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) {
      return res.status(400).json({ error: 'bad sticker id' });
    }
    if (![x, y, rot].every((n) => Number.isFinite(n))) {
      return res.status(400).json({ error: 'bad placement' });
    }
    if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(rot) > 360) {
      return res.status(400).json({ error: 'placement out of range' });
    }

    await kv.rpush(KEY, { id, x: Math.round(x), y: Math.round(y), rot: Math.round(rot), ts: Date.now() });
    await kv.ltrim(KEY, -MAX, -1);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('allow', 'GET, POST');
  return res.status(405).end();
}
