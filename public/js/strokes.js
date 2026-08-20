// Drawing strokes that sweep across the page behind the wall, draw themselves in,
// hold, then undraw from the same end they started.
//
// Screen-space, not world-space: they span the viewport and ignore pan and zoom, so
// they read as someone sketching over the whole page rather than as marks that live
// on the wall itself. They sit behind every piece and never take pointer events.
//
// Implemented with stroke-dashoffset over the path length, which is the one way to
// animate a line drawing itself that stays smooth on the compositor.

const NS = 'http://www.w3.org/2000/svg';

const MIN_GAP = 700;
const MAX_GAP = 2600;
const MAX_CONCURRENT = 9;

// A burst spawns several marks at once, the way a hand lays down a few lines
// together rather than one every few seconds.
const BURST_CHANCE = 0.45;
const BURST_MAX = 3;

export class Strokes {
  constructor(host, { reduced = false } = {}) {
    this.host = host;
    this.reduced = reduced;
    this.live = 0;
    this.timer = null;

    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'strokes');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.resize();
    host.appendChild(this.svg);

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  start() {
    if (this.reduced) return;
    const loop = () => {
      this.burst();
      this.timer = setTimeout(loop, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
    };
    this.timer = setTimeout(loop, 1200);
  }

  stop() {
    clearTimeout(this.timer);
    window.removeEventListener('resize', this.onResize);
  }

  // Four kinds of mark, so density reads as drawing rather than as noise. A page of
  // identical sweeps at this frequency just looks like a screensaver.
  pick() {
    const r = Math.random();
    if (r < 0.5) return 'sweep';
    if (r < 0.72) return 'arc';
    if (r < 0.9) return 'hatch';
    return 'loop';
  }

  // A short straight-ish tick, the kind you make while blocking something in.
  hatchPath() {
    const { w, h } = this;
    const x = w * (0.08 + Math.random() * 0.84);
    const y = h * (0.08 + Math.random() * 0.84);
    const len = 40 + Math.random() * 190;
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    // A slight bow, because nothing drawn by hand is straight.
    const bow = (Math.random() - 0.5) * len * 0.22;
    return `M ${x.toFixed(1)} ${y.toFixed(1)} Q ${(x + dx / 2 - dy * 0.1 + bow).toFixed(1)} ${(y + dy / 2 + dx * 0.1).toFixed(1)} ${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`;
  }

  // An open circular scribble, the shape of someone circling a detail.
  loopPath() {
    const { w, h } = this;
    const cx = w * (0.15 + Math.random() * 0.7);
    const cy = h * (0.15 + Math.random() * 0.7);
    const r = 40 + Math.random() * 150;
    const squash = 0.55 + Math.random() * 0.7;
    const turn = Math.random() * Math.PI * 2;
    const points = [];
    // Slightly more than a full turn, so the ends overshoot each other.
    for (let a = 0; a <= Math.PI * 2.25; a += Math.PI / 6) {
      const wobble = 1 + (Math.random() - 0.5) * 0.16;
      points.push([
        cx + Math.cos(a + turn) * r * wobble,
        cy + Math.sin(a + turn) * r * squash * wobble,
      ]);
    }
    return points
      .map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
  }

  // A single broad curve across part of the page.
  arcPath() {
    const { w, h } = this;
    const x1 = w * (Math.random() * 0.5);
    const y1 = h * (0.1 + Math.random() * 0.8);
    const x2 = x1 + w * (0.3 + Math.random() * 0.5);
    const y2 = h * (0.1 + Math.random() * 0.8);
    const cx = (x1 + x2) / 2 + (Math.random() - 0.5) * w * 0.3;
    const cy = (y1 + y2) / 2 + (Math.random() - 0.5) * h * 0.5;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  // A stroke enters from one edge and leaves by another, wandering through a few
  // control points so it reads as a gesture rather than a swoosh.
  path() {
    const { w, h } = this;
    const edge = Math.floor(Math.random() * 4);
    const along = () => 0.15 + Math.random() * 0.7;

    const starts = [
      [-40, h * along()],
      [w + 40, h * along()],
      [w * along(), -40],
      [w * along(), h + 40],
    ];
    const from = starts[edge];
    const to = starts[(edge + 2 + (Math.random() < 0.4 ? 1 : 0)) % 4];

    const points = [from];
    const segments = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      // Wander perpendicular to the straight line between the ends.
      const x = from[0] + (to[0] - from[0]) * t + (Math.random() - 0.5) * w * 0.4;
      const y = from[1] + (to[1] - from[1]) * t + (Math.random() - 0.5) * h * 0.4;
      points.push([x, y]);
    }
    points.push(to);

    // Smooth the polyline into a curve by aiming each segment at the midpoint of
    // the next, which avoids the corners a naive cubic through every point gives.
    let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${((cx + nx) / 2).toFixed(1)} ${((cy + ny) / 2).toFixed(1)}`;
    }
    const last = points[points.length - 1];
    d += ` T ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
    return d;
  }

  // A burst lays down two or three marks together. Spacing every mark evenly makes
  // the page feel mechanical; clustering them reads as a hand working.
  burst() {
    const n = Math.random() < BURST_CHANCE ? 1 + Math.floor(Math.random() * BURST_MAX) : 1;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.spawn(), i * (90 + Math.random() * 260));
    }
  }

  spawn(kind = this.pick()) {
    if (this.live >= MAX_CONCURRENT || document.hidden) return;

    const d = kind === 'hatch' ? this.hatchPath()
      : kind === 'loop' ? this.loopPath()
      : kind === 'arc' ? this.arcPath()
      : this.path();

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    // Small marks get a finer line, so a hatch does not read as a fat smudge.
    const weight = kind === 'hatch' || kind === 'loop'
      ? 0.9 + Math.random() * 1.8
      : 1.2 + Math.random() * 3.4;
    path.setAttribute('stroke-width', weight.toFixed(2));
    path.setAttribute('opacity', (0.09 + Math.random() * 0.15).toFixed(3));
    this.svg.appendChild(path);

    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length === 0) {
      path.remove();
      return;
    }

    path.style.strokeDasharray = `${length}`;
    this.live++;

    // Short marks are made quickly; a page-spanning sweep takes its time. Scaling
    // by length keeps the apparent speed of the pen roughly constant.
    const pace = Math.min(2.2, Math.max(0.35, length / 900));
    const drawMs = (700 + Math.random() * 1500) * pace;
    const holdMs = 700 + Math.random() * 2600;
    const eraseMs = (500 + Math.random() * 1100) * pace;

    // Draw in from the start, then undraw from that same end, so the mark retreats
    // the way it arrived instead of dissolving.
    const anim = path.animate(
      [
        { strokeDashoffset: length, offset: 0 },
        { strokeDashoffset: 0, offset: drawMs / (drawMs + holdMs + eraseMs) },
        { strokeDashoffset: 0, offset: (drawMs + holdMs) / (drawMs + holdMs + eraseMs) },
        { strokeDashoffset: -length, offset: 1 },
      ],
      { duration: drawMs + holdMs + eraseMs, easing: 'ease-in-out', fill: 'forwards' },
    );

    const done = () => {
      path.remove();
      this.live--;
    };
    anim.addEventListener('finish', done, { once: true });
    anim.addEventListener('cancel', done, { once: true });
  }
}
