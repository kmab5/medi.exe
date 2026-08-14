// Minimal Redis client over the Upstash REST API.
//
// Deliberately dependency-free. @vercel/kv is deprecated, and every Redis
// integration in the Vercel marketplace exposes the same REST protocol, so a
// twenty-line fetch wrapper outlives whichever SDK is current.
//
// Accepts either naming convention: Vercel KV set KV_REST_API_*, the Upstash
// marketplace integration sets UPSTASH_REDIS_REST_*.

const url = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const configured = () => Boolean(url() && token());

export async function redis(...command) {
  const res = await fetch(url(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command.map(String)),
  });

  if (!res.ok) throw new Error(`redis ${command[0]} failed: ${res.status}`);
  const { result, error } = await res.json();
  if (error) throw new Error(`redis ${command[0]}: ${error}`);
  return result;
}

// Values round-trip as JSON strings. Redis has no notion of our shapes, so parse
// defensively — a malformed value should read as absent, not crash the request.
export function parse(value, fallback = null) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
