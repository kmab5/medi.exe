# medi — the wall

An infinite wall of taped-up drawings. Pan and zoom around it, grab a piece and it
peels off its tape, throw it and it slides and settles where it lands. One slider
un-renders every piece on the wall at once, back through flat colour to lineart to a
wobbling underdrawing.

Replaces the old `medi-exe.vercel.app`.

## Quick start

```bash
npm install

# put the unzipped Instagram export at export/tiredmedi/
npm run all        # ingest + build, about a minute for 55 pieces
npm run dev        # http://localhost:5173
```

If you don't have the export to hand, `npm run placeholders && npm run build` fills
`source/` with generated stand-ins so the wall still runs.

## Commands

| Command | What it does |
|---|---|
| `npm run ingest` | Normalises the Instagram export into `source/` |
| `npm run build` | Derives every layer, writes `manifest.json` and `list.html` |
| `npm run all` | Both, in order |
| `npm run dev` | Static server on port 5173 |
| `npm run tag-eyes` | Eye-tagging tool on port 5174 (see below) |
| `npm test` | Layout and physics tests |

## Adding a drawing

Drop a PNG or JPG in `source/` and run `npm run build`. That is the whole workflow —
every layer is derived automatically. Optionally add a title and label:

```json
{
  "my-drawing.jpg": { "title": "snake girl", "label": "ink and stubbornness" }
}
```

in `source/meta.json`.

## The asset pipeline

One flat image per piece goes in. The build step derives:

| Layer | How | Used by |
|---|---|---|
| `final` | resize | the wall at rest |
| `flat` | 10-colour palette quantisation | scrub stage 2 |
| `edge` | Sobel over the flat map | scrub stages 3 and 4 |
| `cutout` | alpha-trim to content | the sticker sheet |
| `thumb` | 72px | the minimap |

Two details that matter. Edges run over the *flat* map, not the original — shading
gradients in the original produce phantom contours through the middle of a face, and
quantising first removes them. And the flat map uses palette quantisation rather than
per-channel banding, because banding each channel independently shifts hue badly:
brown hair goes olive, pink paper goes yellow.

`EDGE_THRESHOLD` and `FLAT_COLOURS` sit at the top of `scripts/build.mjs`. The
threshold is tuned so paper grain and soft airbrush stay out while inked contours
stay in. Graph-paper backgrounds are the case most likely to need a nudge.

## Real WIPs vs the un-render

The scrub stages are synthesised. **They are an effect, not a record of process**, and
the wall never claims otherwise.

Where you have genuine WIP files, they take over. Put them in
`source/wips/<piece-id>/` and rebuild; that piece gets an `actual wip` marker and
uses your real stages. The 7 files from your WIP highlight are sitting in
`source/wips/_unpaired/` — nothing in the export says which finished piece each
belongs to, so pairing them is a manual move.

## Eye tracking

`npm run tag-eyes` serves a page that shows each piece in turn. Click the two eyes,
skip anything that isn't a face. About ten seconds a piece. It writes coordinates
back into `source/meta.json`; rebuild and those pieces' pupils follow the cursor.

Entirely optional — untagged pieces simply don't have eyes.

## Architecture

Vanilla ES modules. No framework, no bundler, no build tooling beyond the two node
scripts.

```
public/js/
  camera.js    pan, zoom, pinch, fly-to. Knows nothing about pieces.
  physics.js   tape-hinge springs, drag, toss, settle. One shared ticker.
  piece.js     one sheet: layers, scrub, flip, stack riffle, eyes.
  layout.js    deterministic placement from the manifest.
  ui.js        scrubber, minimap, sticker sheet, synthesised paper sounds.
  store.js     persistence, with localStorage fallback.
  wall.js      orchestration and the interactions that span units.
```

The un-render is four stacked images cross-faded by opacity, with an SVG
`feDisplacementMap` ramping in over the last third. An earlier draft used Pixi and a
WebGL shader; the DOM version produces the same result with no dependency and
degrades instead of dying when WebGL is unavailable.

Physics has no gravity on translation. The wall is a vertical surface with no floor,
so a detached piece slides and loses energy rather than falling. Weight is a one-off
downward kick at release. Friction is a geometric decay, which guarantees every throw
settles in finite time — a constant downward force does not.

## Persistence

`/api/layout` stores where each visitor left the pieces. `/api/stickers` is the shared
sticker layer. Both use Vercel KV and both return 501 when `KV_REST_API_URL` and
`KV_REST_API_TOKEN` are absent, which the client treats as "use localStorage".

So the wall works as a pure static deploy. You lose the shared sticker layer and
nothing else.

Stickers are **placement-only**: visitors move and stick your own cutouts, and cannot
upload images or draw freehand. That removes essentially the whole moderation surface.
Allowing freehand would need a review queue.

## Accessibility

`list.html` is generated at build time — every piece, plain markup, crawlable and
screen-reader legible. It's linked from the wall and is the fallback when JavaScript
is off or the wall fails to boot.

`prefers-reduced-motion` disables jitter, drift and eye tracking. The scrubber and the
physics stay, because both are user-initiated.

## Deploying

Push to Vercel. `vercel.json` sets the build command and serves `public/`. Add the KV
environment variables if you want the shared sticker layer.

`source/` and `public/art/` are gitignored — the built art is derived, and the export
is large. Run `npm run all` on a fresh clone.

## Known gaps

- Source images cap at 1440px because Instagram re-encodes uploads. If the ibisPaint
  originals exist, dropping them into `source/` is a straight upgrade to the
  zoom-in-on-the-linework experience.
- Nobody has opened this in a browser yet. Logic is tested and every asset path
  resolves, but jitter timing, displacement scale, and frame rate with 55 pieces
  visible are all unvalidated.
- One of the 55 pieces has no recoverable date; it sorts to the start.
