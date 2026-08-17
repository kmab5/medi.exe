// One sheet of paper on the wall. Owns its DOM, its layer image, its preview loop
// and its front/back flip. It does not know about the camera, the store, or the
// other pieces.

import { seedOf } from './layout.js';

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
    // Positioning happens here, not at the end of build(): place() reads this.el,
    // which does not exist until build() has returned.
    this.place(box.x, box.y, box.rot);
  }

  build() {
    const rand = seedOf(this.data.id);
    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.id = this.data.id;
    el.style.width = `${this.box.w}px`;
    el.style.height = `${this.box.h}px`;

    // Movement personality, chosen by seed so it is stable across reloads but
    // unevenly distributed across the wall. Weighted: sway and flutter are the
    // most legible, shrug is rationed because a wall of things lurching at once
    // is noise rather than life.
    const MOVES = ['m-sway', 'm-sway', 'm-flutter', 'm-flutter', 'm-bob', 'm-lean', 'm-shrug'];
    this.move = MOVES[Math.floor(rand() * MOVES.length)];
    el.classList.add(this.move);

    // Amplitude and period vary per piece and per personality. Sway and lean read
    // as gravity so they run slow and wide; flutter is fast and small.
    const slow = this.move === 'm-sway' || this.move === 'm-lean';
    const wide = this.move === 'm-flutter' ? 0.55 : 1;
    el.style.setProperty('--amp', `${(1.4 + rand() * 2.4 * wide).toFixed(2)}deg`);
    el.style.setProperty('--x', `${(2 + rand() * 7).toFixed(1)}px`);
    el.style.setProperty('--y', `${(2 + rand() * 6).toFixed(1)}px`);
    el.style.setProperty('--dur', `${(slow ? 2.2 + rand() * 4.5 : 0.5 + rand() * 1.9).toFixed(2)}s`);
    // Negative delay starts every piece mid-cycle, so nothing is ever in step.
    el.style.setProperty('--delay', `${(-rand() * 8).toFixed(2)}s`);
    el.style.setProperty('--tape-skew', `${((rand() - 0.5) * 16).toFixed(1)}deg`);

    el.innerHTML = `
      <div class="tape" aria-hidden="true"></div>
      <div class="jit">
        <div class="face front">
          <div class="layers" style="background:${this.data.dominant}"></div>
          ${this.data.eyes ? '<div class="eyes" aria-hidden="true"></div>' : ''}
          ${this.data.stack?.length ? `<div class="stack-pip" aria-hidden="true">${this.data.stack.length + 1}</div>` : ''}
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

    // A piece whose source was a video gets its preview loop on the face, sitting
    // above the still. It is created but never loaded until asked to play, so the
    // bytes are only spent on pieces someone actually looks at.
    if (this.data.preview) {
      const v = document.createElement('video');
      v.className = 'layer l-preview';
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'none';
      v.setAttribute('aria-hidden', 'true');
      this.layersEl.appendChild(v);
      this.previewVideo = v;
      this.el.classList.add('has-video');
    }

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

  // Play budget is managed by the wall: only a handful of previews run at once.
  // The source is attached on first play rather than at construction so that a
  // preview which is never seen is never fetched.
  setPreviewPlaying(on) {
    const v = this.previewVideo;
    if (!v) return;
    if (on) {
      if (!v.src) {
        v.src = this.data.preview;
        v.load();
      }
      v.play().then(() => this.el.classList.add('previewing')).catch(() => {});
    } else {
      v.pause();
      this.el.classList.remove('previewing');
    }
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
    this.el.classList.add('riffling');
    setTimeout(() => this.el.classList.remove('riffling'), 220);
  }

  destroy() {
    this.el.remove();
  }
}

