// Chrome around the wall: the scrub slider, the minimap, the sticker sheet, and
// sound. Each is independent and degrades to nothing if its element is absent.

import { store } from './store.js';

export function bindScrubber(el, onChange) {
  const label = document.getElementById('scrub-label');
  const names = ['underdrawing', 'lineart', 'flat colour', 'finished'];
  const update = () => {
    const t = Number(el.value) / 1000;
    onChange(t);
    if (label) label.textContent = names[Math.min(3, Math.floor(t * 3.999))];
  };
  el.addEventListener('input', update);
  update();
  return update;
}

export class Minimap {
  constructor(el, { pieces, bounds, camera, onJump }) {
    this.el = el;
    this.bounds = bounds;
    this.camera = camera;
    this.el.innerHTML = '<div class="mm-view"></div>';
    this.view = this.el.querySelector('.mm-view');

    const w = el.clientWidth || 150;
    this.scale = w / bounds.w;
    el.style.height = `${Math.round(bounds.h * this.scale)}px`;

    for (const p of pieces) {
      const dot = document.createElement('img');
      dot.src = p.data.layers.thumb;
      dot.className = 'mm-dot';
      dot.alt = '';
      dot.style.left = `${(p.box.x - bounds.x) * this.scale}px`;
      dot.style.top = `${(p.box.y - bounds.y) * this.scale}px`;
      dot.style.width = `${Math.max(2, p.box.w * this.scale)}px`;
      el.appendChild(dot);
    }

    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      onJump({
        x: bounds.x + (e.clientX - r.left) / this.scale,
        y: bounds.y + (e.clientY - r.top) / this.scale,
      });
    });
  }

  sync() {
    const c = this.camera;
    const vw = c.viewport.clientWidth / c.scale;
    const vh = c.viewport.clientHeight / c.scale;
    const wx = -c.x / c.scale;
    const wy = -c.y / c.scale;
    this.view.style.left = `${(wx - this.bounds.x) * this.scale}px`;
    this.view.style.top = `${(wy - this.bounds.y) * this.scale}px`;
    this.view.style.width = `${vw * this.scale}px`;
    this.view.style.height = `${vh * this.scale}px`;
  }
}

// Placement-only by design: visitors move and stick the artist's own cutouts but
// cannot upload or draw. That removes essentially the whole moderation surface
// while keeping the play.
export class Stickers {
  constructor({ sheetEl, layerEl, pieces, camera, sound }) {
    this.layer = layerEl;
    this.camera = camera;
    this.sound = sound;
    this.catalogue = pieces
      .filter((p) => p.data.layers.cutout)
      .slice(0, 24)
      .map((p) => ({ id: p.data.id, src: p.data.layers.cutout }));

    for (const s of this.catalogue) {
      const img = document.createElement('img');
      img.src = s.src;
      img.className = 'sticker-choice';
      img.alt = `sticker of ${s.id}`;
      img.draggable = false;
      img.dataset.id = s.id;
      sheetEl.appendChild(img);
      img.addEventListener('pointerdown', (e) => this.startPlacing(e, s));
    }
  }

  async restore() {
    const placed = await store.loadStickers();
    for (const s of placed) this.render(s);
  }

  render(s) {
    const found = this.catalogue.find((c) => c.id === s.id);
    if (!found) return;
    const img = document.createElement('img');
    img.src = found.src;
    img.className = 'sticker';
    img.alt = '';
    img.draggable = false;
    img.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}deg)`;
    this.layer.appendChild(img);
  }

  startPlacing(e, sticker) {
    e.preventDefault();
    const ghost = document.createElement('img');
    ghost.src = sticker.src;
    ghost.className = 'sticker-ghost';
    document.body.appendChild(ghost);

    const move = (ev) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const up = async (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      const w = this.camera.screenToWorld(ev.clientX, ev.clientY);
      const placed = {
        id: sticker.id,
        x: Math.round(w.x),
        y: Math.round(w.y),
        rot: Math.round((Math.random() - 0.5) * 30),
        ts: Date.now(),
      };
      this.render(placed);
      this.sound?.play('stick');
      await store.addSticker(placed);
    };

    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

// Paper sounds, synthesised rather than shipped. Filtered noise bursts read
// convincingly as rustle and tape, and cost nothing to author or download.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    this.ctx?.resume?.();
    return this.enabled;
  }

  play(kind) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const dur = kind === 'peel' ? 0.34 : kind === 'stick' ? 0.12 : 0.2;
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(rate * dur), rate);
    const data = buf.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const p = i / data.length;
      // Peel ramps up as the tape lets go; rustle and stick decay away.
      const env = kind === 'peel' ? Math.sin(p * Math.PI) ** 2 : (1 - p) ** 3;
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = kind === 'stick' ? 1800 : 3400;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }
}
