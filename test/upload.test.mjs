import { test } from 'node:test';
import assert from 'node:assert/strict';

// The upload endpoint is the only route with write access to the repository, so
// its refusals matter more than its successes. These exercise the guards without
// ever reaching GitHub — no network call happens unless auth and validation pass.

const load = async () => (await import('../api/upload.js')).default;

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

const req = (body, key) => ({
  method: 'POST',
  headers: key === undefined ? {} : { 'x-medi-key': key },
  body,
});

const PASSWORD = 'a-long-enough-password';

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (async () => {
    try { return await fn(); }
    finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  })();
}

const configured = {
  GITHUB_TOKEN: 'token', GITHUB_REPO: 'owner/repo', MEDI_PASSWORD: PASSWORD,
};

test('rejects anything that is not a POST', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(configured, () => handler({ ...req({}), method: 'GET' }, res));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('refuses to run when github is not configured', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPO: undefined, MEDI_PASSWORD: PASSWORD },
    () => handler(req({ action: 'blob' }, PASSWORD), res));
  assert.equal(res.statusCode, 501);
});

test('refuses to run when the password is unset or too short', async () => {
  const handler = await load();
  for (const pw of [undefined, 'short']) {
    const res = fakeRes();
    await withEnv({ ...configured, MEDI_PASSWORD: pw },
      () => handler(req({ action: 'blob' }, pw ?? 'x'), res));
    assert.equal(res.statusCode, 503, `password "${pw}" should have been rejected`);
  }
});

test('rejects a missing, wrong, or differently-sized password', async () => {
  const handler = await load();
  for (const key of [undefined, '', 'wrong', `${PASSWORD}x`, PASSWORD.slice(0, -1)]) {
    const res = fakeRes();
    await withEnv(configured, () => handler(req({ action: 'blob' }, key), res));
    assert.equal(res.statusCode, 401, `key ${JSON.stringify(key)} was accepted`);
    assert.equal(res.body.error, 'nope', 'error should not distinguish failure modes');
  }
});

test('rejects unsupported file types before touching github', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(configured, () => handler(
    req({ action: 'blob', type: 'application/x-msdownload', data: 'AAAA' }, PASSWORD), res));
  assert.equal(res.statusCode, 415);
});

test('rejects malformed base64', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(configured, () => handler(
    req({ action: 'blob', type: 'image/jpeg', data: 'not base64 !!!' }, PASSWORD), res));
  assert.equal(res.statusCode, 400);
});

test('rejects a file over the size limit', async () => {
  const handler = await load();
  const res = fakeRes();
  const huge = Buffer.alloc(5 * 1024 * 1024, 1).toString('base64');
  await withEnv(configured, () => handler(
    req({ action: 'blob', type: 'image/jpeg', data: huge }, PASSWORD), res));
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /limit is 4MB/);
});

test('commit rejects empty, oversized, and malformed sheet sets', async () => {
  const handler = await load();
  const sha = 'a'.repeat(40);

  const cases = [
    [{ action: 'commit', title: 't', sheets: [] }, 400],
    [{ action: 'commit', title: 't', sheets: Array(13).fill({ sha }) }, 400],
    [{ action: 'commit', title: 't', sheets: [{ sha: 'nope' }] }, 400],
    [{ action: 'commit', title: 't', sheets: [{ sha }], video: { sha }, posterSha: 'bad' }, 400],
  ];

  for (const [body, expected] of cases) {
    const res = fakeRes();
    await withEnv(configured, () => handler(req(body, PASSWORD), res));
    assert.equal(res.statusCode, expected, `unexpected status for ${JSON.stringify(body).slice(0, 70)}`);
  }
});

test('rejects an unknown action', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(configured, () => handler(req({ action: 'delete-everything' }, PASSWORD), res));
  assert.equal(res.statusCode, 400);
});
