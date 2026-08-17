# medi.exe — the wall

Design spec. 2026-08-14.

## What this is

A replacement for medi-exe.vercel.app. The current site is an about-page wearing a
portfolio's clothes: three works, placeholder social links, and no way to see the art
at any size worth seeing it at.

The replacement is a single infinite canvas — a desk surface with ~51 drawings taped to
it. Visitors pan and zoom. Every piece is a physical sheet of paper: it can be grabbed,
peeled off its tape, swung, flicked across the wall, and flipped over. One global slider
was, at one point, an un-render slider that walked every piece back to its underdrawing.

Nothing on the wall is ever perfectly still.

## Constraints that shaped this

The artist is authoring **no new art assets**. Everything the wall does is derived by
code from a single flat PNG per piece. This rules out drawn puppet rigs and the
wandering-creature idea from brainstorming; both needed hand-drawn frames.

The source art is already physical in character — cutout figures with white sticker
borders, graph-paper backgrounds, handwritten annotations. The wall leans on that rather
than inventing a new visual language.

Traffic arrives mostly from an Instagram bio link, so mobile portrait is the primary
viewport, not an afterthought. Pinch-zoom and drag are native gestures, so the canvas
metaphor gets *easier* on mobile, not harder.

## Architecture

Three units with clean boundaries.

### 1. The build step (`scripts/build.mjs`)

Runs once per image, offline, at deploy time. Never runs in the browser.

Input: a folder of PNG/JPG files plus an optional `meta.json` of titles and labels.
Output: a `manifest.json` and a set of derived layers per piece.

| Derived layer | Produced by | Consumed by |
|---|---|---|
| `final.webp` | resize, strip metadata | the wall at rest |
| `flat.webp` | colour quantisation, shading collapsed | scrubber stage 2 |
| `edge.webp` | Sobel on the flat map, dark on white | scrubber stages 3 and 4 |
| `cutout.webp` | alpha-trim to content bounds | sticker sheet |
| `thumb.webp` | 64px long edge | minimap |
| dominant colour | 3-means over the final | placeholder while loading |

The build step is pure: same input, same output, no network. It is the only thing that
touches image bytes.

### 2. The wall (`public/js/`)

Vanilla ES modules over the DOM. A camera with pan and zoom, viewport culling so only
visible pieces load their layers, and an element per piece carrying its layer images.

**Revised during implementation.** This originally specified Pixi.js over WebGL, on
the reasoning that the un-render needed a fragment shader. It does not: four stacked
images cross-faded by opacity, with an SVG `feDisplacementMap` for the underdrawing
warp, produce the same result with no dependency, no bundler, and graceful
degradation where WebGL is unavailable.

Sub-units:

- `camera` — pan, zoom, clamp, minimap sync. Knows nothing about pieces.
- `piece` — one sheet of paper. Owns its layers, its tape hinge, its physics body, its
  front/back flip state.
- `physics` — damped springs for tape hinge, drag, toss, settle. Hand-rolled, ~150 lines.
  Not Matter.js: the only interactions are drag, throw, and rest. No gravity acts on
  translation — the wall is a vertical surface with no floor, so a thrown piece slides
  under friction and settles. Weight is a one-off kick at release. Constant downward
  force was tried first and never settles, which a test caught.
- `graffiti` — the persisted sticker layer, read and write.

### 3. Persistence (`api/`)

Vercel KV. Two keys per visitor session and one shared key.

- `wall:layout:<visitorId>` — where this visitor has dropped pieces. Private, survives
  return visits, seeded from the default layout.
- `wall:stickers:shared` — the communal sticker layer. Append-only list of
  `{stickerId, x, y, rot, ts}`.

Placement-only. Visitors move and stick the artist's own stickers; they cannot upload
images or draw freehand. This removes the moderation burden almost entirely while keeping
the play, and is a deliberate v1 scope decision rather than a permanent one.

## The un-render — removed

This shipped and was then cut at the artist's request, along with the `flat` and
`edge` layers it needed and the WIP pairing that fed it. The build no longer derives
them. Kept here because the reasoning is still instructive: the stages were
synthesised by edge detection over a colour-quantised copy, which is an effect rather
than a record of process, and that tension was never fully resolved.

## Piece backs

Flick a piece hard enough and it flips. The back carries the handwritten label, the
timelapse if one exists, and the commission link. This is where real process content
lives, sourced from existing reels at no authoring cost.

## Ambient motion

With puppets out of scope, motion comes from code:

- Every piece jitters on `steps()` timing, ~8fps, never eased. Amplitude and period are
  seeded per piece from its hash so no two are in phase.
- Pieces lean away from the cursor as it passes.
- On a slow random timer, one piece slips a few pixels and re-settles.
- Paper rustle and tape sounds, muted by default, one obvious toggle.

**Eye tracking** is the one exception where the artist spends time. A tagging tool
(`scripts/tag-eyes.mjs`) shows each portrait and records two click coordinates. Roughly
ten seconds per piece, twenty minutes for the account. Tagged pieces get pupils that
follow the cursor. Untagged pieces are unaffected — the field is optional in the manifest.

## The margin

Negative space between pieces is not empty. It carries the artist's own annotation
material — arrows, crossed-out thumbnails, marginalia — placed as low-priority sprites
that fade in below a zoom threshold. Sourced from existing sketch pages, so still no new
authoring.

## Accessibility and degradation

- Everything reachable by canvas drag is also reachable from a plain list view at
  `/index` — the whole catalogue as a static, crawlable, screen-reader-legible page. This
  is also what search engines see.
- `prefers-reduced-motion` kills jitter, slip, and lean. The scrubber and physics stay,
  since both are user-initiated.
- WebGL failure falls back to the list view rather than a broken canvas.

## Out of scope for v1

Freehand drawing on the shared layer. The sleep state. Reaction chorus. Audio beyond the
two paper sounds. These are additive and none of them change the architecture.

## Success criteria

1. A visitor on a phone can see any drawing at full resolution within two gestures.
   (Note: "full resolution" is capped at 1440px by Instagram's re-encoding of the
   source uploads.)
2. The scrubber runs at 60fps with 55 pieces visible on a mid-range Android.
3. Adding a new drawing is: drop a PNG in a folder, redeploy. No hand-editing of anything.
4. The commission path is reachable from any piece without leaving the wall.
