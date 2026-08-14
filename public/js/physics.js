// Paper physics. Not a rigid-body engine — the only behaviours the wall needs are
// swing from a tape hinge, drag, toss, and settle, and a damped spring gives all
// four in a form that is easy to reason about.
//
// There is deliberately no gravity on translation. The wall is a vertical surface
// seen face-on and has no floor, so a detached piece slides and loses energy rather
// than falling. Weight is expressed as a one-off downward kick at the moment of
// release. Friction is a pure geometric decay, which guarantees every throw comes
// to rest in finite time — a constant downward force does not, and an early version
// of this had thrown pieces accelerating to terminal velocity forever.
//
// One shared ticker drives every body, so the cost is one rAF regardless of how
// many pieces are in flight.

const SLIDE_FRICTION = 0.93;
const RELEASE_WEIGHT = 4;
const SPIN_DECAY = 0.95;
const LANDING_SPEED = 0.6;
const HINGE_STIFFNESS = 0.09;
const HINGE_DAMPING = 0.86;
const SETTLE_EPSILON = 0.02;

export class Body {
  constructor(piece, { x, y, rot }) {
    this.piece = piece;
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.restRot = rot;
    this.vx = 0;
    this.vy = 0;
    this.vr = 0;
    this.held = false;
    this.free = false;   // detached from its tape and falling
    this.asleep = true;
  }

  wake() {
    this.asleep = false;
  }

  grab() {
    this.held = true;
    this.wake();
    this.vx = this.vy = this.vr = 0;
  }

  // Releasing with speed detaches the piece from its tape. Below the threshold it
  // stays hinged and just swings back.
  release(vx, vy) {
    this.held = false;
    this.vx = vx;
    this.vy = vy;
    const speed = Math.hypot(vx, vy);
    if (speed > 9) {
      this.free = true;
      // Weight, applied once. A permanent downward force would never let the
      // piece settle.
      this.vy += RELEASE_WEIGHT;
      this.vr = (vx / 12) * (Math.random() > 0.5 ? 1 : -1);
    }
    this.wake();
  }

  step() {
    if (this.held || this.asleep) return false;

    if (this.free) {
      this.vx *= SLIDE_FRICTION;
      this.vy *= SLIDE_FRICTION;
      this.x += this.vx;
      this.y += this.vy;
      this.rot += this.vr;
      this.vr *= SPIN_DECAY;

      // Paper does not bounce. When it slows enough it just lies down, and where
      // it lies becomes the piece's new home.
      if (Math.hypot(this.vx, this.vy) < LANDING_SPEED) {
        this.free = false;
        this.restRot = this.rot;
        this.vx = this.vy = this.vr = 0;
      }
      return true;
    }

    // Hinged: spring back toward rest angle, swinging past it and settling.
    const delta = this.restRot - this.rot;
    this.vr += delta * HINGE_STIFFNESS;
    this.vr *= HINGE_DAMPING;
    this.rot += this.vr;

    this.vx *= 0.8;
    this.vy *= 0.8;
    this.x += this.vx;
    this.y += this.vy;

    if (Math.abs(this.vr) < SETTLE_EPSILON &&
        Math.abs(delta) < SETTLE_EPSILON &&
        Math.abs(this.vx) < SETTLE_EPSILON &&
        Math.abs(this.vy) < SETTLE_EPSILON) {
      this.rot = this.restRot;
      this.vr = this.vx = this.vy = 0;
      this.asleep = true;
    }
    return true;
  }
}

export class World {
  constructor() {
    this.bodies = new Set();
    this.running = false;
    this.onSettle = () => {};
  }

  add(body) {
    this.bodies.add(body);
    return body;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      let awake = 0;
      for (const b of this.bodies) {
        const wasAsleep = b.asleep;
        if (b.step()) {
          b.piece.place(b.x, b.y, b.rot);
          awake++;
        }
        if (!wasAsleep && b.asleep) this.onSettle(b);
      }
      this._awake = awake;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }
}

// Tracks pointer velocity so a release can be turned into a toss. Sampling the
// last few moves rather than just the final one stops a momentary pause before
// letting go from reading as a dead throw.
export class Velocity {
  constructor() {
    this.samples = [];
  }

  push(x, y) {
    const now = performance.now();
    this.samples.push({ x, y, t: now });
    while (this.samples.length > 5) this.samples.shift();
  }

  get() {
    if (this.samples.length < 2) return { vx: 0, vy: 0 };
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = Math.max(16, b.t - a.t);
    return { vx: ((b.x - a.x) / dt) * 16, vy: ((b.y - a.y) / dt) * 16 };
  }

  clear() {
    this.samples.length = 0;
  }
}
