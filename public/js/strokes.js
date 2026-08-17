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

const MIN_GAP = 2600;
const MAX_GAP = 7000;
const MAX_CONCURRENT = 3;

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
      this.spawn();
      this.timer = setTimeout(loop, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
    };
    this.timer = setTimeout(loop, 1200);
  }

  stop() {
    clearTimeout(this.timer);
    window.removeEventListener('resize', this.onResize);
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

  spawn() {
    if (this.live >= MAX_CONCURRENT || document.hidden) return;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', this.path());
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-width', (1.2 + Math.random() * 3.4).toFixed(2));
    path.setAttribute('opacity', (0.1 + Math.random() * 0.14).toFixed(3));
    this.svg.appendChild(path);

    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length === 0) {
      path.remove();
      return;
    }

    path.style.strokeDasharray = `${length}`;
    this.live++;

    const drawMs = 1400 + Math.random() * 2600;
    const holdMs = 900 + Math.random() * 2400;
    const eraseMs = 900 + Math.random() * 1800;

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
