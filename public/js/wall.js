// Orchestrator. Loads the manifest, builds pieces, and wires the interactions that
// span more than one unit: dragging a piece, opening one, culling offscreen pieces,
// and the ambient behaviour that keeps the wall from ever being fully still.

import { Camera, bindCameraGestures } from './camera.js';
import { World, Body, Velocity } from './physics.js';
import { Piece } from './piece.js';
import { Note } from './note.js';
import { defaultLayout, marginLayout, noteLayout, boundsOf } from './layout.js';
import { Minimap, Stickers, Sound } from './ui.js';
import { store } from './store.js';
import { Strokes } from './strokes.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const stickerLayer = document.getElementById('sticker-layer');
const marginLayer = document.getElementById('margin-layer');

const state = {
  // `pieces` is everything physical on the wall, notes included — they share an
  // interface so physics, dragging and culling treat them identically. `artwork`
  // is the subset that is a drawing rather than writing.
  pieces: [],
  artwork: [],
  byId: new Map(),
  layout: {},
  open: null,
};

async function boot() {
  const manifest = await fetch('art/manifest.json').then((r) => r.json());

  const base = defaultLayout(manifest.pieces);
  Object.assign(base, noteLayout(manifest.notes ?? [], base));
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
    state.artwork.push(piece);
    state.byId.set(data.id, piece);
    bindPieceGestures(piece, camera, physics, sound);
  }

  for (const data of manifest.notes ?? []) {
    const box = { ...state.layout[data.id] };
    if (!box || box.w == null) continue;
    const note = new Note(data, box, { onOpen: open });
    note.body = physics.add(new Body(note, box));
    world.appendChild(note.el);
    state.pieces.push(note);
    state.byId.set(data.id, note);
    bindPieceGestures(note, camera, physics, sound);
  }

  renderMargin(manifest.margin, state.layout);

  const bounds = boundsOf(state.layout);
  camera.bounds = bounds;
  camera.fit(bounds);

  minimap = new Minimap(document.getElementById('minimap'), {
    pieces: state.artwork,
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

  const stickers = new Stickers({
    sheetEl: document.getElementById('sticker-sheet'),
    layerEl: stickerLayer,
    pieces: state.artwork,
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
  if (!reduced) startAmbient(camera);
  wireChrome(camera, sound, bounds);

  // Background strokes live outside the world transform, so they sweep the page
  // rather than the wall and are unaffected by pan and zoom.
  const strokes = new Strokes(document.getElementById('backdrop'), { reduced });
  strokes.start();

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
    // A note's body is meant to be read and selected, so drags start from its
    // title, its edges or its tape. Everything else on the wall drags anywhere.
    if (piece.isNote && e.target.closest('.note-body, .note-links')) return;
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

  updatePreviews(camera);
}

// At most a few preview loops run at once. Decoding eighteen videos simultaneously
// would cost more than the whole rest of the wall, so the budget goes to whichever
// video pieces are closest to the centre of the screen — and only once the piece is
// large enough on screen for the motion to actually read.
const PREVIEW_BUDGET = 4;
const PREVIEW_MIN_PX = 150;

function updatePreviews(camera) {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const cx = vw / 2;
  const cy = vh / 2;

  const candidates = [];
  for (const p of state.artwork) {
    if (!p.previewVideo) continue;
    const s = camera.worldToScreen(p.box.x + p.box.w / 2, p.box.y + p.box.h / 2);
    const onScreen = s.x > -100 && s.x < vw + 100 && s.y > -100 && s.y < vh + 100;
    const bigEnough = p.box.w * camera.scale >= PREVIEW_MIN_PX;
    if (onScreen && bigEnough) {
      candidates.push({ piece: p, d: Math.hypot(s.x - cx, s.y - cy) });
    }
  }

  candidates.sort((a, b) => a.d - b.d);
  const playing = new Set(candidates.slice(0, PREVIEW_BUDGET).map((c) => c.piece));

  for (const p of state.artwork) {
    if (p.previewVideo) p.setPreviewPlaying(playing.has(p));
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
  if (piece.isNote) {
    cap.querySelector('.cap-meta').textContent = 'a note';
    return;
  }
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
    for (const p of state.artwork) {
      if (p.pupils && !p.el.classList.contains('offscreen')) p.lookAt(w.x, w.y);
    }
  });

  // Ambient disturbance. Every few seconds something on the wall shifts on its
  // own. Kinds are mixed so it never reads as one repeating tic: a nudge is a
  // small spin, a slip drags the piece a little way and leaves it there, and a
  // gust hits several neighbours at once.
  const disturb = () => {
    const visible = state.pieces.filter((p) => !p.el.classList.contains('offscreen'));
    if (visible.length) {
      const roll = Math.random();
      const pick = () => visible[Math.floor(Math.random() * visible.length)];

      if (roll < 0.55) {
        const p = pick();
        p.body.vr += (Math.random() - 0.5) * 5;
        p.body.wake();
      } else if (roll < 0.85) {
        const p = pick();
        p.body.vx += (Math.random() - 0.5) * 7;
        p.body.vy += (Math.random() - 0.5) * 5;
        p.body.vr += (Math.random() - 0.5) * 3;
        p.body.wake();
      } else {
        for (const p of visible.slice(0, 6)) {
          p.body.vr += (Math.random() - 0.5) * 3.5;
          p.body.vx += (Math.random() - 0.5) * 3;
          p.body.wake();
        }
      }
    }
    // Irregular interval, so the wall never feels metronomic.
    setTimeout(disturb, 1400 + Math.random() * 3600);
  };
  setTimeout(disturb, 1800);
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
    const p = state.artwork[Math.floor(Math.random() * state.artwork.length)];
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
