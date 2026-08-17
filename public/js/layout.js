// Places pieces on the wall. Deterministic: the same manifest always produces the
// same wall, so the artist can reason about where things are, and a returning
// visitor's saved positions still line up against a rebuild.

const SHEET_WIDTH = 320;
const GAP = 90;
const ROW_JITTER = 70;

// A cheap seeded PRNG. Seeding from the piece id means each piece's tilt and
// offset are stable across reloads without storing anything.
export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

// Chronological left-to-right in loose rows, oldest at the left. Reading the wall
// horizontally is reading the artist's timeline.
export function defaultLayout(pieces, { columns = 8 } = {}) {
  const layout = {};

  pieces.forEach((piece, i) => {
    const rand = seedOf(piece.id);
    const col = i % columns;
    const row = Math.floor(i / columns);

    const height = SHEET_WIDTH / (piece.aspect || 1);
    const x = col * (SHEET_WIDTH + GAP) + (rand() - 0.5) * GAP * 0.8;
    const y = row * (SHEET_WIDTH * 1.25 + GAP) + (rand() - 0.5) * ROW_JITTER;

    layout[piece.id] = {
      x: Math.round(x),
      y: Math.round(y),
      // Tape is applied by hand, so nothing hangs straight.
      rot: +((rand() - 0.5) * 7).toFixed(2),
      w: SHEET_WIDTH,
      h: Math.round(height),
    };
  });

  return layout;
}

// Margin doodles fill the gaps between pieces. They are placed by rejecting
// positions that collide with a finished piece, so they read as scribbles in the
// whitespace rather than as competing artwork.
export function marginLayout(margin, pieceLayout) {
  const boxes = Object.values(pieceLayout);
  if (!boxes.length) return {};

  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));

  const hits = (x, y, w, h) => boxes.some((b) =>
    x < b.x + b.w + 24 && x + w + 24 > b.x && y < b.y + b.h + 24 && y + h + 24 > b.y);

  const layout = {};
  for (const m of margin) {
    const rand = seedOf(m.id);
    const w = 110 + rand() * 70;
    const h = w / (m.aspect || 1);

    for (let attempt = 0; attempt < 60; attempt++) {
      const x = minX + rand() * (maxX - minX);
      const y = minY + rand() * (maxY - minY);
      if (!hits(x, y, w, h)) {
        layout[m.id] = {
          x: Math.round(x), y: Math.round(y),
          w: Math.round(w), h: Math.round(h),
          rot: +((rand() - 0.5) * 26).toFixed(2),
        };
        break;
      }
    }
  }
  return layout;
}

// Notes hang in a column to the left of the oldest work, like a noticeboard beside
// the wall rather than scattered through it. Deliberate placement, because writing
// that has to be hunted for does not get read.
const NOTE_WIDTH = 400;

export function noteLayout(notes, pieceLayout) {
  const boxes = Object.values(pieceLayout);
  const minX = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const maxY = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 1200;

  const gap = 90;
  const layout = {};
  let y = minY;

  for (const note of notes) {
    const rand = seedOf(note.id);
    // Height follows the amount of writing, so a one-line note is not a tall
    // empty card.
    const lines = (note.body ?? []).reduce((n, p) => n + Math.ceil(p.length / 42), 0);
    const h = Math.round(120 + lines * 26 + (note.links?.length ?? 0) * 30);

    layout[note.id] = {
      x: Math.round(minX - NOTE_WIDTH - 220 + (rand() - 0.5) * 70),
      y: Math.round(y),
      w: NOTE_WIDTH,
      h,
      rot: +((rand() - 0.5) * 4).toFixed(2),
    };
    y += h + gap;
  }

  // If the notes column runs longer than the wall, that is fine — bounds are
  // computed from everything together.
  void maxY;
  return layout;
}

export function boundsOf(layout) {
  const boxes = Object.values(layout);
  if (!boxes.length) return { x: 0, y: 0, w: 1000, h: 1000 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 300;
  return { x: x - pad, y: y - pad, w: r - x + pad * 2, h: bt - y + pad * 2 };
}
