// The camera owns the transform from world coordinates to screen. It knows nothing
// about pieces — it is handed a viewport element and a world element and moves one
// inside the other.

const MIN_SCALE = 0.08;
const MAX_SCALE = 2.4;

export class Camera {
  constructor(viewport, world, { onChange } = {}) {
    this.viewport = viewport;
    this.world = world;
    this.onChange = onChange ?? (() => {});
    this.x = 0;
    this.y = 0;
    this.scale = 0.3;
    this.bounds = null;
    this._raf = null;
    this._target = null;
  }

  apply() {
    this.world.style.transform =
      `translate(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px) scale(${this.scale.toFixed(4)})`;
    this.onChange(this);
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  worldToScreen(wx, wy) {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
    this.apply();
  }

  // Zoom about a screen point so the world position under the cursor stays put.
  zoomAt(sx, sy, factor) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    if (next === this.scale) return;
    const before = this.screenToWorld(sx, sy);
    this.scale = next;
    const after = this.screenToWorld(sx, sy);
    this.x += (after.x - before.x) * this.scale;
    this.y += (after.y - before.y) * this.scale;
    this.clamp();
    this.apply();
  }

  clamp() {
    if (!this.bounds) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const b = this.bounds;
    // Allow half a viewport of overscroll past the content so the edge of the wall
    // does not feel like hitting a wall.
    const slackX = vw * 0.5;
    const slackY = vh * 0.5;
    const minX = -(b.x + b.w) * this.scale + slackX;
    const maxX = -b.x * this.scale + vw - slackX;
    const minY = -(b.y + b.h) * this.scale + slackY;
    const maxY = -b.y * this.scale + vh - slackY;
    if (minX < maxX) this.x = Math.min(maxX, Math.max(minX, this.x));
    if (minY < maxY) this.y = Math.min(maxY, Math.max(minY, this.y));
  }

  // Ease to a world rectangle. Used when a piece is opened.
  flyTo(box, { pad = 80, maxScale = 1.4 } = {}) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const scale = Math.min(
      maxScale,
      Math.min((vw - pad * 2) / box.w, (vh - pad * 2) / box.h),
    );
    this._target = {
      scale,
      x: vw / 2 - (box.x + box.w / 2) * scale,
      y: vh / 2 - (box.y + box.h / 2) * scale,
    };
    this._tick();
  }

  _tick() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const step = () => {
      const t = this._target;
      if (!t) return;
      const k = 0.16;
      this.x += (t.x - this.x) * k;
      this.y += (t.y - this.y) * k;
      this.scale += (t.scale - this.scale) * k;
      this.apply();
      const done = Math.abs(t.x - this.x) < 0.5 &&
        Math.abs(t.y - this.y) < 0.5 &&
        Math.abs(t.scale - this.scale) < 0.001;
      if (done) {
        this.x = t.x; this.y = t.y; this.scale = t.scale;
        this._target = null;
        this.apply();
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  stop() {
    this._target = null;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  fit(bounds) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.scale = Math.min(vw / bounds.w, vh / bounds.h) * 0.95;
    this.x = vw / 2 - (bounds.x + bounds.w / 2) * this.scale;
    this.y = vh / 2 - (bounds.y + bounds.h / 2) * this.scale;
    this.apply();
  }
}

// Pointer plumbing: drag to pan, wheel to zoom, two fingers to pinch. Returns a
// dispose function. Drags that start on a piece are claimed by the piece and never
// reach here.
export function bindCameraGestures(camera, viewport, { isBackground }) {
  const pointers = new Map();
  let panning = false;
  let last = null;
  let pinchDist = 0;

  const down = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      panning = false;
      return;
    }
    if (!isBackground(e.target)) return;
    panning = true;
    last = { x: e.clientX, y: e.clientY };
    camera.stop();
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('panning');
  };

  const move = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist);
      }
      pinchDist = dist;
      return;
    }

    if (!panning) return;
    camera.panBy(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  };

  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      panning = false;
      viewport.classList.remove('panning');
    }
  };

  const wheel = (e) => {
    e.preventDefault();
    camera.stop();
    // Trackpad pinch arrives as ctrlKey+wheel and needs a gentler response than
    // a mouse wheel notch.
    const intensity = e.ctrlKey ? 0.01 : 0.0022;
    camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * intensity));
  };

  viewport.addEventListener('pointerdown', down);
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('wheel', wheel, { passive: false });

  return () => {
    viewport.removeEventListener('pointerdown', down);
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    viewport.removeEventListener('pointercancel', up);
    viewport.removeEventListener('wheel', wheel);
  };
}
