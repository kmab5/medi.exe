import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, marginLayout, boundsOf, seedOf } from '../public/js/layout.js';
import { Body, World, Velocity } from '../public/js/physics.js';

const fakePieces = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`, aspect: 1 + (i % 3) * 0.2,
}));

test('layout is deterministic across runs', () => {
  const a = defaultLayout(fakePieces);
  const b = defaultLayout(fakePieces);
  assert.deepEqual(a, b);
});

test('layout gives every piece a finite box', () => {
  const l = defaultLayout(fakePieces);
  assert.equal(Object.keys(l).length, fakePieces.length);
  for (const box of Object.values(l)) {
    for (const k of ['x', 'y', 'w', 'h', 'rot']) assert.ok(Number.isFinite(box[k]), k);
    assert.ok(box.w > 0 && box.h > 0);
    assert.ok(Math.abs(box.rot) < 10, 'tilt stays plausible');
  }
});

test('no two pieces land on the exact same spot', () => {
  const l = defaultLayout(fakePieces);
  const seen = new Set(Object.values(l).map((b) => `${b.x},${b.y}`));
  assert.equal(seen.size, fakePieces.length);
});

test('seed is stable and in range', () => {
  const r1 = seedOf('abc'), r2 = seedOf('abc');
  for (let i = 0; i < 20; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

test('margin doodles avoid overlapping pieces', () => {
  const pieceLayout = defaultLayout(fakePieces);
  const margin = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, aspect: 1 }));
  const ml = marginLayout(margin, pieceLayout);
  for (const m of Object.values(ml)) {
    for (const b of Object.values(pieceLayout)) {
      const overlaps = m.x < b.x + b.w && m.x + m.w > b.x && m.y < b.y + b.h && m.y + m.h > b.y;
      assert.ok(!overlaps, 'doodle overlaps a finished piece');
    }
  }
});

test('bounds enclose every piece', () => {
  const l = defaultLayout(fakePieces);
  const b = boundsOf(l);
  for (const box of Object.values(l)) {
    assert.ok(box.x >= b.x && box.y >= b.y);
    assert.ok(box.x + box.w <= b.x + b.w);
    assert.ok(box.y + box.h <= b.y + b.h);
  }
});

const stubPiece = () => ({ placed: [], place(x, y, r) { this.placed.push([x, y, r]); } });

test('a hinged piece swings back to rest and falls asleep', () => {
  const p = stubPiece();
  const b = new Body(p, { x: 0, y: 0, rot: 3 });
  b.rot = 20;
  b.wake();
  let steps = 0;
  while (!b.asleep && steps < 4000) { b.step(); steps++; }
  assert.ok(b.asleep, 'never settled');
  assert.ok(Math.abs(b.rot - 3) < 0.05, `rest angle off: ${b.rot}`);
  assert.ok(steps < 600, `took too long: ${steps}`);
});

test('a hard throw detaches the piece and it eventually lands', () => {
  const p = stubPiece();
  const b = new Body(p, { x: 0, y: 0, rot: 0 });
  b.grab();
  b.release(40, -10);
  assert.ok(b.free, 'should have detached');
  let steps = 0;
  while (b.free && steps < 4000) { b.step(); steps++; }
  assert.ok(!b.free, 'never landed');
  assert.ok(b.x > 0, 'should have travelled in the throw direction');
  assert.equal(b.restRot, b.rot, 'landed angle becomes the new rest angle');
});

test('a gentle release stays hinged', () => {
  const b = new Body(stubPiece(), { x: 0, y: 0, rot: 0 });
  b.grab();
  b.release(2, 1);
  assert.ok(!b.free);
});

test('a settled body does no work', () => {
  const p = stubPiece();
  const b = new Body(p, { x: 0, y: 0, rot: 0 });
  assert.equal(b.step(), false);
  assert.equal(p.placed.length, 0);
});

test('velocity tracker averages recent motion', () => {
  const v = new Velocity();
  v.push(0, 0);
  v.push(10, 0);
  v.push(20, 0);
  const { vx, vy } = v.get();
  assert.ok(vx > 0, 'rightward drag reads positive');
  assert.equal(Math.round(vy), 0);
  v.clear();
  assert.deepEqual(v.get(), { vx: 0, vy: 0 });
});

test('world drives bodies and reports settling once', () => {
  const w = new World();
  const p = stubPiece();
  const b = w.add(new Body(p, { x: 0, y: 0, rot: 0 }));
  let settled = 0;
  w.onSettle = () => { settled++; };
  b.rot = 10; b.wake();
  for (let i = 0; i < 500; i++) {
    const wasAsleep = b.asleep;
    if (b.step()) p.place(b.x, b.y, b.rot);
    if (!wasAsleep && b.asleep) w.onSettle(b);
  }
  assert.equal(settled, 1, 'settle fired more than once');
});
