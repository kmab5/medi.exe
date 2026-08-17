// A written note pinned to the wall. Deliberately implements the same surface as
// Piece — el, box, place, worldBox, load, setPreviewPlaying — so the
// physics, drag binding and culling in wall.js do not need to know which is which.

import { seedOf } from './layout.js';

const MOVES = ['m-sway', 'm-lean', 'm-bob'];

export class Note {
  constructor(data, box, { onOpen } = {}) {
    this.data = data;
    this.box = box;
    this.onOpen = onOpen ?? (() => {});
    this.isNote = true;
    this.loaded = true;
    this.el = this.build();
    this.place(box.x, box.y, box.rot);
  }

  build() {
    const rand = seedOf(this.data.id);
    const el = document.createElement('article');
    el.className = `piece note kind-${this.data.kind ?? 'note'}`;
    el.dataset.id = this.data.id;
    el.style.width = `${this.box.w}px`;
    el.style.height = `${this.box.h}px`;

    // Notes move like paper too, but only the calmer personalities — text that
    // flutters is text nobody can read.
    el.classList.add(MOVES[Math.floor(rand() * MOVES.length)]);
    el.style.setProperty('--amp', `${(0.7 + rand() * 1.1).toFixed(2)}deg`);
    el.style.setProperty('--x', `${(1 + rand() * 3).toFixed(1)}px`);
    el.style.setProperty('--y', `${(1 + rand() * 3).toFixed(1)}px`);
    el.style.setProperty('--dur', `${(3.4 + rand() * 4).toFixed(2)}s`);
    el.style.setProperty('--delay', `${(-rand() * 8).toFixed(2)}s`);
    el.style.setProperty('--tape-skew', `${((rand() - 0.5) * 14).toFixed(1)}deg`);

    const body = (this.data.body ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const links = (this.data.links ?? [])
      .map((l) => `<a href="${escapeHtml(l.href)}" rel="noopener">${escapeHtml(l.label)}</a>`)
      .join('');

    el.innerHTML = `
      <div class="tape" aria-hidden="true"></div>
      <div class="jit">
        <div class="face front note-face">
          <h2 class="note-title">${escapeHtml(this.data.title ?? '')}</h2>
          <div class="note-body">${body}</div>
          ${links ? `<div class="note-links">${links}</div>` : ''}
        </div>
      </div>`;

    el.setAttribute('tabindex', '0');
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
    this.el.style.transform =
      `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
  }

  worldBox() {
    return { x: this.box.x, y: this.box.y, w: this.box.w, h: this.box.h };
  }

  // Notes have nothing to lazy-load, no video and no stack. Implemented as no-ops
  // so callers never have to branch on type.
  load() {}
  setPreviewPlaying() {}
  riffle() {}
  flip() {}
  lookAt() {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
