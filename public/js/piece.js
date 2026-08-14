// One sheet of paper on the wall. Owns its DOM, its layer images, its scrub state,
// and its front/back flip. It does not know about the camera, the store, or the
// other pieces.

import { seedOf } from './layout.js';

const SCRUB_STAGES = 3; // final -> flat -> edge

export class Piece {
  constructor(data, box, { onOpen, onGrab } = {}) {
    this.data = data;
    this.box = box;
    this.onOpen = onOpen ?? (() => {});
    this.onGrab = onGrab ?? (() => {});
    this.loaded = false;
    this.flipped = false;
    this.sheetIndex = 0;
    this.el = this.build();
  }

  build() {
    const rand = seedOf(this.data.id);
    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.id = this.data.id;
    el.style.width = `${this.box.w}px`;
    el.style.height = `${this.box.h}px`;
    // Per-piece jitter phase and period, seeded from the id so it is stable across
    // reloads but no two pieces are ever in step with each other.
    el.style.setProperty('--jit-dur', `${(0.42 + rand() * 0.5).toFixed(2)}s`);
    el.style.setProperty('--jit-delay', `${(-rand() * 2).toFixed(2)}s`);
    el.style.setProperty('--jit-amp', `${(0.3 + rand() * 0.55).toFixed(2)}deg`);
    el.style.setProperty('--tape-skew', `${((rand() - 0.5) * 16).toFixed(1)}deg`);

    el.innerHTML = `
      <div class="tape" aria-hidden="true"></div>
      <div class="jit">
        <div class="face front">
          <div class="layers" style="background:${this.data.dominant}"></div>
          ${this.data.eyes ? '<div class="eyes" aria-hidden="true"></div>' : ''}
          ${this.data.stack?.length ? `<div class="stack-pip" aria-hidden="true">${this.data.stack.length + 1}</div>` : ''}
          ${this.data.realWip ? '<div class="wip-flag">actual wip</div>' : ''}
        </div>
        <div class="face back">
          <p class="back-title"></p>
          <p class="back-label"></p>
          <div class="back-media"></div>
          <a class="back-cta" href="#commission">commission something like this</a>
        </div>
      </div>`;

    this.jit = el.querySelector('.jit');
    this.layersEl = el.querySelector('.layers');
    this.backEl = el.querySelector('.back');

    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', this.data.title || this.data.id);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onOpen(this);
      }
    });

    this.place(this.box.x, this.box.y, this.box.rot);
    return el;
  }

  place(x, y, rot) {
    this.box.x = x;
    this.box.y = y;
    this.box.rot = rot;
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
  }

  worldBox() {
    return { x: this.box.x, y: this.box.y, w: this.box.w, h: this.box.h };
  }

  // Layers are fetched only when the piece first comes near the viewport. With 55
  // pieces and three layers each, loading everything up front would be 160 requests
  // before the wall is usable.
  load() {
    if (this.loaded) return;
    this.loaded = true;

    const layers = this.data.layers;
    const add = (key, cls) => {
      if (!layers[key]) return null;
      const img = document.createElement('img');
      img.src = layers[key];
      img.className = `layer ${cls}`;
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      this.layersEl.appendChild(img);
      return img;
    };

    this.finalImg = add('final', 'l-final');
    this.finalImg?.addEventListener('load', () => this.el.classList.add('ready'), { once: true });
    this.flatImg = add('flat', 'l-flat');
    this.edgeImg = add('edge', 'l-edge');

    if (this.data.eyes) this.buildEyes();
    this.fillBack();
  }

  buildEyes() {
    const holder = this.el.querySelector('.eyes');
    if (!holder) return;
    this.pupils = this.data.eyes.map((e) => {
      const socket = document.createElement('span');
      socket.className = 'eye';
      socket.style.left = `${e.x * 100}%`;
      socket.style.top = `${e.y * 100}%`;
      socket.style.width = `${(e.r ?? 0.035) * 200}%`;
      const pupil = document.createElement('span');
      pupil.className = 'pupil';
      socket.appendChild(pupil);
      holder.appendChild(socket);
      return pupil;
    });
  }

  // Pupils drift toward a world-space point. Amplitude is capped so eyes never
  // leave their sockets.
  lookAt(wx, wy) {
    if (!this.pupils) return;
    const cx = this.box.x + this.box.w / 2;
    const cy = this.box.y + this.box.h / 2;
    const a = Math.atan2(wy - cy, wx - cx);
    const d = Math.min(1, Math.hypot(wx - cx, wy - cy) / 900);
    const px = Math.cos(a) * d * 26;
    const py = Math.sin(a) * d * 26;
    for (const p of this.pupils) p.style.transform = `translate(${px.toFixed(1)}%, ${py.toFixed(1)}%)`;
  }

  fillBack() {
    const d = this.data;
    this.backEl.querySelector('.back-title').textContent = d.title || d.id;

    const date = d.posted
      ? new Date(d.posted).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
      : '';
    this.backEl.querySelector('.back-label').textContent = [d.label, date].filter(Boolean).join(' · ');

    if (d.timelapse) {
      const v = document.createElement('video');
      v.src = d.timelapse;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'none';
      this.backEl.querySelector('.back-media').appendChild(v);
      this.video = v;
    }
  }

  // t runs 1 (final render) to 0 (underdrawing). Stages cross-fade; the warp only
  // ramps in over the last third so the lines go uncertain rather than the whole
  // image smearing.
  setScrub(t) {
    if (!this.loaded) return;
    const s = t * SCRUB_STAGES;

    if (this.flatImg) this.flatImg.style.opacity = String(clamp01(2 - s));
    if (this.edgeImg) this.edgeImg.style.opacity = String(clamp01(1 - s));

    const warp = clamp01(1 - s * 1.5);
    this.el.classList.toggle('warped', warp > 0.02);
    this.el.style.setProperty('--warp', warp.toFixed(3));
  }

  flip() {
    this.flipped = !this.flipped;
    this.el.classList.toggle('flipped', this.flipped);
    if (this.video) {
      if (this.flipped) this.video.play().catch(() => {});
      else this.video.pause();
    }
  }

  // Albums are a stack of sheets. Clicking the pip riffles to the next one.
  riffle() {
    const sheets = [this.data, ...(this.data.stack ?? [])];
    if (sheets.length < 2) return;
    this.sheetIndex = (this.sheetIndex + 1) % sheets.length;
    const next = sheets[this.sheetIndex];
    if (this.finalImg) this.finalImg.src = next.layers.final;
    // Only sheet one has flat and edge layers built, so scrubbing a riffled stack
    // falls back to the final image alone rather than showing a stale underdrawing.
    const isPrimary = this.sheetIndex === 0;
    if (this.flatImg) this.flatImg.style.display = isPrimary ? '' : 'none';
    if (this.edgeImg) this.edgeImg.style.display = isPrimary ? '' : 'none';
    this.el.classList.add('riffling');
    setTimeout(() => this.el.classList.remove('riffling'), 220);
  }

  destroy() {
    this.el.remove();
  }
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
