import { test } from 'node:test';
import assert from 'node:assert/strict';

// The visibility endpoint writes source/meta.json, which the build reads to decide
// what exists. A malformed write here silently removes work from the site, so the
// refusals matter more than the successes.

const load = async () => (await import('../api/pieces.js')).default;

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

const PASSWORD = 'a-long-enough-password';
const env = { GITHUB_TOKEN: 't', GITHUB_REPO: 'owner/repo', MEDI_PASSWORD: PASSWORD };

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return (async () => {
    try { return await fn(); } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  })();
}

// Headers built explicitly — a defaulted argument would substitute the real password
// when passed undefined, which silently turns an auth test into a network test.
const post = (body, key = PASSWORD) => ({
  method: 'POST',
  headers: key === null ? {} : { 'x-medi-key': key },
  body,
});

test('refuses without the password', async () => {
  const handler = await load();
  for (const key of [null, 'wrong']) {
    const res = fakeRes();
    await withEnv(env, () => handler(post({ updates: {} }, key), res));
    assert.equal(res.statusCode, 401);
  }
});

test('rejects updates that are not an object of file to boolean', async () => {
  const handler = await load();
  for (const updates of [undefined, [], "x", 42, { "a.jpg": "yes" }]) {
    const res = fakeRes();
    await withEnv(env, () => handler(post({ updates }), res));
    assert.equal(res.statusCode, 400, `accepted ${JSON.stringify(updates)}`);
  }
});

test('rejects a method it does not implement', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(env, () => handler({ method: 'DELETE', headers: {}, body: {} }, res));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});

test('refuses when github is unconfigured rather than failing later', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv({ ...env, GITHUB_TOKEN: undefined, GITHUB_REPO: undefined },
    () => handler(post({ updates: {} }), res));
  assert.equal(res.statusCode, 501);
});

test('session endpoint accepts only POST and only the right key', async () => {
  const handler = (await import('../api/session.js')).default;

  const wrongMethod = fakeRes();
  await withEnv(env, () => handler({ method: 'GET', headers: {} }, wrongMethod));
  assert.equal(wrongMethod.statusCode, 405);

  const badKey = fakeRes();
  await withEnv(env, () => handler({ method: 'POST', headers: { 'x-medi-key': 'nope' } }, badKey));
  assert.equal(badKey.statusCode, 401);

  const good = fakeRes();
  await withEnv(env, () => handler({ method: 'POST', headers: { 'x-medi-key': PASSWORD } }, good));
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.ok, true);
  assert.equal(good.body.github, true);
});

test('session reports github state so the dashboard can warn up front', async () => {
  const handler = (await import('../api/session.js')).default;
  const res = fakeRes();
  await withEnv({ ...env, GITHUB_TOKEN: undefined },
    () => handler({ method: 'POST', headers: { 'x-medi-key': PASSWORD } }, res));
  assert.equal(res.statusCode, 200, 'sign-in should still succeed');
  assert.equal(res.body.github, false);
});
