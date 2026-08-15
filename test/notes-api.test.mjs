import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRepo } from '../api/_github.js';

// The notes endpoint writes to the repo, so its validation is a security boundary
// and not merely input tidying. Nothing here reaches GitHub: every case is refused
// before a network call, or asserts on pure functions.

const load = async () => (await import('../api/notes.js')).default;

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

// Headers are built explicitly rather than via a default parameter: passing
// undefined to a defaulted argument silently substitutes the real password, which
// made an auth test pass a valid key and then fail against the network.
const post = (notes, key = PASSWORD) => ({
  method: 'POST',
  headers: key === null ? {} : { 'x-medi-key': key },
  body: { notes },
});

test('GITHUB_REPO accepts a clone url, an ssh remote, or a plain slug', () => {
  const expected = 'kmab5/medi.exe';
  for (const input of [
    'kmab5/medi.exe',
    'https://github.com/kmab5/medi.exe.git',
    'https://github.com/kmab5/medi.exe',
    'git@github.com:kmab5/medi.exe.git',
    '  https://github.com/kmab5/medi.exe/  ',
  ]) {
    assert.equal(normaliseRepo(input), expected, `failed on ${input}`);
  }
});

test('GITHUB_REPO rejects nonsense rather than passing it to the api', () => {
  for (const input of [undefined, '', 'not-a-repo', 'https://example.com/a/b', 'a/b/c']) {
    assert.equal(normaliseRepo(input), null, `should have rejected ${input}`);
  }
});

test('notes endpoint refuses without the password', async () => {
  const handler = await load();
  for (const key of [null, 'wrong', `${PASSWORD}x`]) {
    const res = fakeRes();
    await withEnv(env, () => handler(post([], key), res));
    assert.equal(res.statusCode, 401);
  }
});

test('rejects a note with no title', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(env, () => handler(post([{ title: '   ', body: ['x'] }]), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /needs a title/);
});

test('rejects duplicate ids, which would collide in the layout', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(env, () => handler(post([
    { title: 'Same Title' },
    { title: 'same title' },
  ]), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /share the id/);
});

test('rejects a javascript: link', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(env, () => handler(post([
    { title: 'ok', links: [{ label: 'x', href: 'javascript:alert(1)' }] },
  ]), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /http, https or mailto/);
});

test('rejects oversized input', async () => {
  const handler = await load();

  const tooMany = fakeRes();
  await withEnv(env, () => handler(post(Array(30).fill({ title: 'x' })), tooMany));
  assert.equal(tooMany.statusCode, 400);

  const longPara = fakeRes();
  await withEnv(env, () => handler(post([{ title: 'x', body: ['y'.repeat(3000)] }]), longPara));
  assert.equal(longPara.statusCode, 400);

  const notAList = fakeRes();
  await withEnv(env, () => handler(post('nope'), notAList));
  assert.equal(notAList.statusCode, 400);
});

test('rejects a method it does not implement', async () => {
  const handler = await load();
  const res = fakeRes();
  await withEnv(env, () => handler({ method: 'DELETE', headers: {}, body: {} }, res));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});
