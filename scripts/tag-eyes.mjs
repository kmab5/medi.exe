// Eye tagging tool. Serves a page that shows each portrait in turn; two clicks per
// piece records where the eyes are. Roughly ten seconds a piece.
//
// This is the one place the artist spends time, and it is clicking, not drawing.
// Writes back into source/meta.json so the next build picks it up.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SRC = process.argv[2] ?? 'source';
const ART = process.argv[3] ?? 'public/art';
const PORT = Number(process.env.PORT ?? 5174);

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const PAGE = `<!doctype html><meta charset="utf-8"><title>tag eyes</title>
<style>
 body{font:15px system-ui;margin:0;display:grid;grid-template-rows:auto 1fr auto;height:100vh;background:#f4f1e8}
 header,footer{padding:12px 16px}
 #stage{display:grid;place-items:center;overflow:hidden}
 #wrap{position:relative;max-height:70vh}
 img{max-height:70vh;max-width:90vw;display:block;cursor:crosshair}
 .mark{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #c33;border-radius:50%}
 button{font:inherit;padding:6px 12px;margin-right:8px}
</style>
<header><b>click the two eyes</b> — skip anything that is not a face. <span id="pos"></span></header>
<div id="stage"><div id="wrap"><img id="img" alt=""></div></div>
<footer>
  <button id="skip">skip</button><button id="undo">undo</button><button id="save">save all</button>
  <span id="status"></span>
</footer>
<script type="module">
const manifest = await fetch('/manifest.json').then(r=>r.json());
const pieces = manifest.pieces;
let i = 0, marks = [];
const out = {};
const img = document.getElementById('img'), wrap = document.getElementById('wrap');

function show(){
  if(i>=pieces.length){ document.getElementById('status').textContent='done — press save'; return; }
  marks=[]; [...wrap.querySelectorAll('.mark')].forEach(m=>m.remove());
  img.src = '/' + pieces[i].layers.final;
  document.getElementById('pos').textContent = (i+1)+' / '+pieces.length+' — '+pieces[i].id;
}
img.addEventListener('click', e=>{
  const r = img.getBoundingClientRect();
  const x = (e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
  const m=document.createElement('div'); m.className='mark';
  m.style.left=(x*100)+'%'; m.style.top=(y*100)+'%'; wrap.appendChild(m);
  marks.push({x:+x.toFixed(4), y:+y.toFixed(4), r:0.035});
  if(marks.length===2){ out[pieces[i].id]=marks.slice(); i++; show(); }
});
document.getElementById('skip').onclick=()=>{ i++; show(); };
document.getElementById('undo').onclick=()=>{ i=Math.max(0,i-1); delete out[pieces[i].id]; show(); };
document.getElementById('save').onclick=async()=>{
  const res = await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(out)});
  document.getElementById('status').textContent = res.ok ? 'saved to meta.json' : 'save failed';
};
show();
</script>`;

const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }

  if (req.url === '/save' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const eyes = JSON.parse(body);
    const metaPath = join(SRC, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));

    let n = 0;
    for (const [id, coords] of Object.entries(eyes)) {
      // Manifest ids are derived from source filenames, so map back by prefix.
      const file = Object.keys(meta).find((f) => f.replace(/\.[^.]+$/, '').toLowerCase() === id);
      if (!file) continue;
      meta[file].eyes = coords;
      n++;
    }
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    console.log(`tagged ${n} pieces`);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, tagged: n }));
  }

  const path = req.url === '/manifest.json' ? join(ART, 'manifest.json') : join('.', decodeURIComponent(req.url));
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => console.log(`tag eyes at http://localhost:${PORT}`));
