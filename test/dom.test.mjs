import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// These tests exist because two fatal boot errors shipped without one: a temporal
// dead zone throw in wall.js, and a constructor in piece.js reading this.el before
// it was assigned. Both were invisible to syntax checks and to logic tests that
// never touched the DOM. Anything that constructs DOM belongs here.

let dom;

before(async () => {
  const html = await readFile('public/index.html', 'utf8');
  dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });

  for (const key of ['window', 'document', 'HTMLElement', 'Image', 'Node',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'matchMedia']) {
    globalThis[key] = key === 'matchMedia' ? dom.window.matchMedia : dom.window[key];
  }
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  // jsdom has no layout, so measurements read zero. Give the elements plausible
  // dimensions so anything dividing by a width does not produce NaN.
  for (const prop of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, prop, {
      configurable: true,
      get() { return prop === 'clientWidth' ? 1200 : 800; },
    });
  }
});

after(() => dom?.window?.close());

async function manifest() {
  return JSON.parse(await readFile('public/art/manifest.json', 'utf8'));
}

test('index.html contains every element the wall queries by id', async () => {
  const wall = await readFile('public/js/wall.js', 'utf8');
  const ui = await readFile('public/js/ui.js', 'utf8');
  const ids = [...`${wall}${ui}`.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map((m) => m[1]);

  assert.ok(ids.length > 5, 'expected the wall to query several ids');
  for (const id of new Set(ids)) {
    assert.ok(dom.window.document.getElementById(id), `#${id} missing from index.html`);
  }
});

test('a Piece constructs and positions itself without throwing', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const data = m.pieces[0];
  const box = { x: 120, y: 240, w: 320, h: 400, rot: 3 };

  const piece = new Piece(data, box);

  assert.ok(piece.el, 'element was never created');
  assert.match(piece.el.style.transform, /translate3d\(120\.0px, 240\.0px, 0\) rotate\(3\.00deg\)/);
  assert.equal(piece.el.dataset.id, data.id);
  assert.equal(piece.el.getAttribute('role'), 'button');
});

test('every piece in the real manifest constructs', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const { defaultLayout } = await import('../public/js/layout.js');
  const m = await manifest();
  const layout = defaultLayout(m.pieces);

  for (const data of m.pieces) {
    const piece = new Piece(data, { ...layout[data.id] });
    assert.ok(piece.el, `${data.id} produced no element`);
  }
});

test('loading a piece attaches its layer images and back matter', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const data = m.pieces.find((p) => p.layers.flat && p.layers.edge);

  const piece = new Piece(data, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  piece.load();

  const layers = piece.el.querySelectorAll('.layer');
  assert.equal(layers.length, 3, 'expected final, flat and edge');
  assert.ok(piece.el.querySelector('.back-title').textContent.length > 0);

  // Loading twice must not duplicate the images.
  piece.load();
  assert.equal(piece.el.querySelectorAll('.layer').length, 3);
});

test('scrubbing drives layer opacity across the full range', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const data = m.pieces.find((p) => p.layers.flat && p.layers.edge);
  const piece = new Piece(data, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  piece.load();

  piece.setScrub(1);
  assert.equal(Number(piece.flatImg.style.opacity), 0, 'finished state shows no flat layer');
  assert.equal(Number(piece.edgeImg.style.opacity), 0);
  assert.ok(!piece.el.classList.contains('warped'));

  piece.setScrub(0);
  assert.equal(Number(piece.edgeImg.style.opacity), 1, 'underdrawing shows the edge layer');
  assert.ok(piece.el.classList.contains('warped'), 'wobble should engage at the far end');

  // Nothing should ever leave the 0..1 range at any point on the slider.
  for (let t = 0; t <= 1.0001; t += 0.05) {
    piece.setScrub(t);
    for (const img of [piece.flatImg, piece.edgeImg]) {
      const o = Number(img.style.opacity);
      assert.ok(o >= 0 && o <= 1, `opacity ${o} out of range at t=${t.toFixed(2)}`);
    }
  }
});

test('a piece with eyes builds pupils that move when looked at', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const data = { ...m.pieces[0], eyes: [{ x: 0.4, y: 0.3, r: 0.035 }, { x: 0.6, y: 0.3, r: 0.035 }] };

  const piece = new Piece(data, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  piece.load();

  assert.equal(piece.pupils.length, 2);
  piece.lookAt(9000, 9000);
  assert.match(piece.pupils[0].style.transform, /translate\(/);
});

test('a piece without eyes has no eye layer at all', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const piece = new Piece({ ...m.pieces[0], eyes: null }, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  piece.load();
  assert.equal(piece.el.querySelector('.eyes'), null);
  assert.equal(piece.pupils, undefined);
});

test('flipping toggles state and riffling cycles an album stack', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();

  const flat = new Piece(m.pieces[0], { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  flat.load();
  flat.flip();
  assert.ok(flat.el.classList.contains('flipped'));
  flat.flip();
  assert.ok(!flat.el.classList.contains('flipped'));

  const album = m.pieces.find((p) => p.stack.length > 0);
  assert.ok(album, 'manifest should contain at least one album');
  const stacked = new Piece(album, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  stacked.load();

  const first = stacked.finalImg.getAttribute('src');
  stacked.riffle();
  assert.notEqual(stacked.finalImg.getAttribute('src'), first, 'riffle did not change sheet');
  assert.equal(stacked.sheetIndex, 1);

  // Riffling all the way round returns to the first sheet.
  for (let i = 0; i < album.stack.length; i++) stacked.riffle();
  assert.equal(stacked.sheetIndex, 0);
  assert.equal(stacked.finalImg.getAttribute('src'), first);
});

test('scrub layers are hidden on non-primary sheets', async () => {
  const { Piece } = await import('../public/js/piece.js');
  const m = await manifest();
  const album = m.pieces.find((p) => p.stack.length > 0);
  const piece = new Piece(album, { x: 0, y: 0, w: 300, h: 400, rot: 0 });
  piece.load();

  piece.riffle();
  assert.equal(piece.flatImg.style.display, 'none', 'stale underdrawing would show through');
  piece.riffle();
  while (piece.sheetIndex !== 0) piece.riffle();
  assert.equal(piece.flatImg.style.display, '');
});
