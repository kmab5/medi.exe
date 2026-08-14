// Orchestrator. Loads the manifest, builds pieces, and wires the interactions that
// span more than one unit: dragging a piece, opening one, culling offscreen pieces,
// and the ambient behaviour that keeps the wall from ever being fully still.

import { Camera, bindCameraGestures } from './camera.js';
import { World, Body, Velocity } from './physics.js';
import { Piece } from './piece.js';
import { defaultLayout, marginLayout, boundsOf } from './layout.js';
import { bindScrubber, Minimap, Stickers, Sound } from './ui.js';
import { store } from './store.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const stickerLayer = document.getElementById('sticker-layer');
const marginLayer = document.getElementById('margin-layer');

const state = {
  pieces: [],
  byId: new Map(),
  layout: {},
  open: null,
};

async function boot() {
  const manifest = await fetch('art/manifest.json').then((r) => r.json());

  const base = defaultLayout(manifest.pieces);
  const saved = await store.loadLayout();
  // Saved positions are merged over the generated ones so a rebuild that adds new
  // pieces does not wipe where a visitor left the old ones.
  state.layout = { ...base, ...saved };

  const physics = new World();
  const sound = new Sound();

  // Declared before the camera because the camera's onChange fires during fit(),
  // which happens before the minimap is constructed. Referencing a `const` there
  // would throw on the very first frame.
  let minimap = null;

  const camera = new Camera(viewport, world, {
    onChange: () => {
      minimap?.sync();
      scheduleCull();
    },
  });

  for (const data of manifest.pieces) {
    const box = { ...state.layout[data.id] };
    const piece = new Piece(data, box, { onOpen: open });
    piece.body = physics.add(new Body(piece, box));
    world.appendChild(piece.el);
    state.pieces.push(piece);
    state.byId.set(data.id, piece);
    bindPieceGestures(piece, camera, physics, sound);
  }

  renderMargin(manifest.margin, state.layout);

  const bounds = boundsOf(state.layout);
  camera.bounds = bounds;
  camera.fit(bounds);

  minimap = new Minimap(document.getElementById('minimap'), {
    pieces: state.pieces,
    bounds,
    camera,
    onJump: (w) => camera.flyTo({ x: w.x - 400, y: w.y - 400, w: 800, h: 800 }, { maxScale: 0.5 }),
  });

  // Stickers are stuck on top of the wall, so the layer has to sit above the
  // pieces. Re-appending moves it to the end of the world's children.
  world.appendChild(stickerLayer);

  bindCameraGestures(camera, viewport, {
    isBackground: (target) => !target.closest('.piece') && !target.closest('.sticker'),
  });

  const applyScrub = bindScrubber(document.getElementById('scrub'), (t) => {
    for (const p of state.pieces) p.setScrub(t);
  });

  const stickers = new Stickers({
    sheetEl: document.getElementById('sticker-sheet'),
    layerEl: stickerLayer,
    pieces: state.pieces,
    camera,
    sound,
  });
  await stickers.restore();

  physics.onSettle = (body) => {
    state.layout[body.piece.data.id] = {
      ...state.layout[body.piece.data.id],
      x: Math.round(body.x), y: Math.round(body.y), rot: +body.rot.toFixed(2),
    };
    store.saveLayout(state.layout);
  };
  physics.start();

  cull(camera);
  applyScrub();
  if (!reduced) startAmbient(camera);
  wireChrome(camera, sound, bounds);

  document.body.classList.add('booted');
  document.getElementById('count').textContent = manifest.count;
}

function renderMargin(margin, pieceLayout) {
  const layout = marginLayout(margin, pieceLayout);
  for (const m of margin) {
    const box = layout[m.id];
    if (!box) continue;
    const img = document.createElement('img');
    img.src = m.layers.final;
    img.className = 'margin-doodle';
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    img.style.width = `${box.w}px`;
    img.style.transform = `translate3d(${box.x}px, ${box.y}px, 0) rotate(${box.rot}deg)`;
    marginLayer.appendChild(img);
  }
}

// Dragging a piece. Pointer deltas are divided by camera scale so a piece tracks
// the cursor exactly regardless of zoom.
function bindPieceGestures(piece, camera, physics, sound) {
  const vel = new Velocity();
  let dragging = false;
  let start = null;
  let moved = 0;

  piece.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.back-cta')) return;
    e.stopPropagation();

    if (e.target.closest('.stack-pip')) {
      piece.riffle();
      sound.play('rustle');
      return;
    }

    dragging = true;
    moved = 0;
    start = { x: e.clientX, y: e.clientY, px: piece.box.x, py: piece.box.y };
    vel.clear();
    piece.body.grab();
    piece.el.classList.add('held');
    piece.el.setPointerCapture(e.pointerId);
    sound.play('peel');
  });

  piece.el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - start.x) / camera.scale;
    const dy = (e.clientY - start.y) / camera.scale;
    moved = Math.max(moved, Math.hypot(dx, dy));
    vel.push(e.clientX, e.clientY);
    piece.body.x = start.px + dx;
    piece.body.y = start.py + dy;
    // Lag the angle behind the motion so the sheet trails like paper.
    piece.body.rot = piece.body.restRot + Math.max(-14, Math.min(14, dx * 0.05));
    piece.place(piece.body.x, piece.body.y, piece.body.rot);
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    piece.el.classList.remove('held');
    const { vx, vy } = vel.get();
    piece.body.release(vx / camera.scale, vy / camera.scale);

    // A press that never really moved is a click, not a throw.
    if (moved < 4) {
      if (e.shiftKey) piece.flip();
      else open(piece);
    } else {
      sound.play('rustle');
    }
  };

  piece.el.addEventListener('pointerup', end);
  piece.el.addEventListener('pointercancel', () => { dragging = false; piece.el.classList.remove('held'); });
  piece.el.addEventListener('dblclick', (e) => { e.stopPropagation(); piece.flip(); });
}

let cullTimer = null;
let cameraRef = null;

function scheduleCull() {
  if (cullTimer) return;
  cullTimer = setTimeout(() => {
    cullTimer = null;
    if (cameraRef) cull(cameraRef);
  }, 120);
}

// Load layers for anything near the viewport and unload nothing — 55 pieces is
// small enough that eviction would cost more in re-decoding than it saves.
function cull(camera) {
  cameraRef = camera;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const pad = 600;

  for (const p of state.pieces) {
    const s = camera.worldToScreen(p.box.x, p.box.y);
    const w = p.box.w * camera.scale;
    const h = p.box.h * camera.scale;
    const visible = s.x + w > -pad && s.x < vw + pad && s.y + h > -pad && s.y < vh + pad;
    if (visible) p.load();
    p.el.classList.toggle('offscreen', !visible);
  }
}

function open(piece) {
  if (state.open === piece) {
    close();
    return;
  }
  state.open = piece;
  document.body.classList.add('focused');
  piece.el.classList.add('open');
  cameraRef?.flyTo(piece.worldBox());

  const cap = document.getElementById('caption');
  cap.querySelector('.cap-title').textContent = piece.data.title || piece.data.id;
  const date = piece.data.posted
    ? new Date(piece.data.posted).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : '';
  cap.querySelector('.cap-meta').textContent =
    [piece.data.label, date, piece.data.stack?.length ? `${piece.data.stack.length + 1} sheets` : '']
      .filter(Boolean).join(' · ');
}

function close() {
  if (state.open) state.open.el.classList.remove('open');
  state.open = null;
  document.body.classList.remove('focused');
}

// Ambient behaviour. Nothing here is essential, and all of it is disabled under
// prefers-reduced-motion.
function startAmbient(camera) {
  // Eyes follow the cursor.
  let lastLook = 0;
  viewport.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastLook < 60) return;
    lastLook = now;
    const w = camera.screenToWorld(e.clientX, e.clientY);
    for (const p of state.pieces) {
      if (p.pupils && !p.el.classList.contains('offscreen')) p.lookAt(w.x, w.y);
    }
  });

  // Every so often a piece slips a little and re-settles, so the wall is always
  // quietly coming apart even when nobody is touching it.
  setInterval(() => {
    const candidates = state.pieces.filter((p) => !p.el.classList.contains('offscreen'));
    if (!candidates.length) return;
    const p = candidates[Math.floor(Math.random() * candidates.length)];
    p.body.vr += (Math.random() - 0.5) * 1.6;
    p.body.wake();
  }, 6500);
}

function wireChrome(camera, sound, bounds) {
  document.getElementById('sound-toggle').addEventListener('click', (e) => {
    const on = sound.toggle();
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'sound on' : 'sound off';
  });

  document.getElementById('reset').addEventListener('click', () => {
    camera.fit(bounds);
    close();
  });

  document.getElementById('shuffle').addEventListener('click', () => {
    const p = state.pieces[Math.floor(Math.random() * state.pieces.length)];
    camera.flyTo(p.worldBox(), { maxScale: 0.9 });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  viewport.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.piece')) close();
  });

  window.addEventListener('resize', () => { camera.clamp(); camera.apply(); });
}

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('failed');
});
