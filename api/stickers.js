// The shared sticker layer. Placement-only: the body names one of the artist's own
// cutouts and a position, so there is no user-supplied media to moderate.

import { redis, parse, configured } from './_redis.js';

const KEY = 'wall:stickers:shared';
const MAX = 4000;

export default async function handler(req, res) {
  if (!configured()) return res.status(501).json({ error: 'redis not configured' });

  try {
    if (req.method === 'GET') {
      const raw = await redis('LRANGE', KEY, -MAX, -1);
      const stickers = (raw ?? []).map((s) => parse(s)).filter(Boolean);
      return res.status(200).json({ stickers });
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

      const sticker = {
        id,
        x: Math.round(x),
        y: Math.round(y),
        rot: Math.round(rot),
        ts: Date.now(),
      };
      await redis('RPUSH', KEY, JSON.stringify(sticker));
      await redis('LTRIM', KEY, -MAX, -1);
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'storage unavailable' });
  }

  res.setHeader('allow', 'GET, POST');
  return res.status(405).end();
}
