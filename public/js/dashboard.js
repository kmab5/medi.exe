// Dashboard behind /medi-login.
//
// The password is held in sessionStorage for the tab's lifetime and sent as a header
// on every request. It is not a session token and grants nothing on its own — each
// endpoint checks it independently, so a forged "signed in" state in the browser
// buys access to nothing.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.86;
const MAX_BYTES = 4 * 1024 * 1024;
const KEY_STORE = 'medi.key';
const KINDS = ['note', 'index', 'sticky', 'receipt'];

const $ = (id) => document.getElementById(id);

let key = sessionStorage.getItem(KEY_STORE) ?? '';
let pieces = [];
let pending = {};   // file -> hidden, only what differs from what is saved
let notes = [];
let files = [];

function log(msg, cls = '', target = 'log') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  $(target).appendChild(line);
}
const clearLog = (target = 'log') => { $(target).innerHTML = ''; };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-medi-key': key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({ error: `http ${res.status}` }));
  if (!res.ok) {
    // A rejected key mid-session means the password changed or was never right;
    // drop straight back to the login screen rather than failing silently.
    if (res.status === 401) signOut();
    throw new Error(json.error ?? `http ${res.status}`);
  }
  return json;
}

/* ---- login ---- */

async function signIn() {
  clearLog('login-log');
  $('signin').disabled = true;
  try {
    key = $('key').value;
    if (!key) throw new Error('enter the password');
    const out = await api('/api/session', { method: 'POST' });
    sessionStorage.setItem(KEY_STORE, key);
    $('login').style.display = 'none';
    $('app').classList.add('on');
    if (!out.github) {
      log('GITHUB_TOKEN or GITHUB_REPO is not set — you can look but not save.', 'err');
    }
    await loadPieces();
  } catch (err) {
    log(err.message, 'err', 'login-log');
  } finally {
    $('signin').disabled = false;
  }
}

function signOut() {
  sessionStorage.removeItem(KEY_STORE);
  key = '';
  pending = {};
  $('app').classList.remove('on');
  $('login').style.display = 'grid';
  $('key').value = '';
}

$('signin').addEventListener('click', signIn);
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
$('signout').addEventListener('click', signOut);

/* ---- panels ---- */

for (const btn of document.querySelectorAll('.navbtn[data-panel]')) {
  btn.addEventListener('click', () => {
    const name = btn.dataset.panel;
    for (const b of document.querySelectorAll('.navbtn[data-panel]')) {
      b.classList.toggle('on', b === btn);
    }
    for (const p of document.querySelectorAll('.panel')) {
      p.classList.toggle('on', p.id === `panel-${name}`);
    }
    clearLog();
    if (name === 'notes' && !notes.length) loadNotes();
  });
}

/* ---- pieces ---- */

async function loadPieces() {
  clearLog();
  try {
    const out = await api('/api/pieces');
    pieces = out.pieces;
    pending = {};
    renderPieces();
  } catch (err) {
    log(err.message, 'err');
  }
}

const isHidden = (p) => (p.file in pending ? pending[p.file] : p.hidden);

function renderPieces() {
  const host = $('tiles');
  host.innerHTML = '';

  if (!pieces.length) {
    host.innerHTML = '<p class="empty">Nothing here yet. Add something from "add new".</p>';
    return;
  }

  for (const p of pieces) {
    const hidden = isHidden(p);
    const tile = document.createElement('div');
    tile.className = `tile${hidden ? ' off' : ''}`;

    const when = p.posted
      ? new Date(p.posted).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
      : '';

    tile.innerHTML = `
      <div class="shot"><img loading="lazy" alt=""></div>
      <div class="meta">
        <div class="name"></div>
        <div class="when"></div>
        <div class="row">
          <span class="pill"></span>
          <button class="sw" role="switch" aria-label="show on the wall"></button>
        </div>
      </div>`;

    // Thumbnails come from the built manifest paths, which are derived from the id.
    tile.querySelector('img').src = `art/${p.id}/thumb.webp`;
    tile.querySelector('.name').textContent = p.title || p.id;
    tile.querySelector('.when').textContent = when;
    tile.querySelector('.pill').textContent =
      [p.sheets > 1 ? `${p.sheets} sheets` : '', p.hasVideo ? 'video' : ''].filter(Boolean).join(' · ') || 'image';

    const sw = tile.querySelector('.sw');
    sw.setAttribute('aria-checked', String(!hidden));
    sw.addEventListener('click', () => {
      const next = !isHidden(p);
      // Toggling back to the saved value removes it from pending rather than
      // recording a no-op change.
      if (next === p.hidden) delete pending[p.file];
      else pending[p.file] = next;
      renderPieces();
    });

    host.appendChild(tile);
  }

  const shown = pieces.filter((p) => !isHidden(p)).length;
  $('visible-count').textContent = `${shown} of ${pieces.length} on the wall`;

  const n = Object.keys(pending).length;
  $('savebar').classList.toggle('on', n > 0);
  $('pending').textContent = n ? `${n} change${n === 1 ? '' : 's'} not saved` : '';
}

$('save-pieces').addEventListener('click', async () => {
  clearLog();
  $('save-pieces').disabled = true;
  try {
    const out = await api('/api/pieces', { method: 'POST', body: { updates: pending } });
    log(out.commit ? `saved ${out.changed} change(s) as ${out.commit.slice(0, 7)}` : 'nothing to save', 'ok');
    if (out.commit) log('The site is rebuilding.', 'ok');
    await loadPieces();
  } catch (err) {
    log(err.message, 'err');
  } finally {
    $('save-pieces').disabled = false;
  }
});

$('discard').addEventListener('click', () => { pending = {}; renderPieces(); });

/* ---- notes ---- */

const bodyToText = (body) => (body ?? []).join('\n\n');
const textToBody = (text) => String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const linksToText = (links) => (links ?? []).map((l) => `${l.label} | ${l.href}`).join('\n');
const textToLinks = (text) => String(text).split('\n').map((line) => {
  const i = line.indexOf('|');
  if (i < 0) return null;
  const label = line.slice(0, i).trim();
  const href = line.slice(i + 1).trim();
  return label && href ? { label, href } : null;
}).filter(Boolean);

async function loadNotes() {
  try {
    notes = (await api('/api/notes')).notes ?? [];
    renderNotes();
  } catch (err) {
    log(err.message, 'err');
  }
}

function renderNotes() {
  const host = $('notes');
  host.innerHTML = '';

  notes.forEach((note, i) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    const kinds = KINDS.map((k) =>
      `<option value="${k}"${k === (note.kind ?? 'note') ? ' selected' : ''}>${k}</option>`).join('');

    card.innerHTML = `
      <div class="note-head">
        <input type="text" class="title" placeholder="title">
        <select class="kind">${kinds}</select>
        <button class="sw" role="switch" aria-label="show this note"></button>
        <button class="iconbtn up" title="move up">↑</button>
        <button class="iconbtn down" title="move down">↓</button>
        <button class="iconbtn danger del" title="remove">✕</button>
      </div>
      <label>body</label>
      <textarea class="body"></textarea>
      <label>links</label>
      <textarea class="links"></textarea>`;

    // Assigned, never interpolated: a quote or angle bracket in Medi's writing
    // must not be able to break out of the markup.
    card.querySelector('.title').value = note.title ?? '';
    card.querySelector('.body').value = bodyToText(note.body);
    card.querySelector('.links').value = linksToText(note.links);

    const sw = card.querySelector('.sw');
    sw.setAttribute('aria-checked', String(!note.hidden));
    sw.addEventListener('click', () => {
      note.hidden = !note.hidden;
      renderNotes();
    });

    const sync = () => {
      note.title = card.querySelector('.title').value;
      note.kind = card.querySelector('.kind').value;
      note.body = textToBody(card.querySelector('.body').value);
      note.links = textToLinks(card.querySelector('.links').value);
    };
    for (const el of card.querySelectorAll('input, textarea, select')) {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    }

    card.querySelector('.del').addEventListener('click', () => { notes.splice(i, 1); renderNotes(); });
    card.querySelector('.up').addEventListener('click', () => {
      if (i === 0) return;
      [notes[i - 1], notes[i]] = [notes[i], notes[i - 1]];
      renderNotes();
    });
    card.querySelector('.down').addEventListener('click', () => {
      if (i === notes.length - 1) return;
      [notes[i + 1], notes[i]] = [notes[i], notes[i + 1]];
      renderNotes();
    });

    host.appendChild(card);
  });

  const save = document.createElement('button');
  save.className = 'primary';
  save.style.width = 'auto';
  save.textContent = 'save notes';
  save.addEventListener('click', async () => {
    clearLog();
    save.disabled = true;
    try {
      const out = await api('/api/notes', { method: 'POST', body: { notes } });
      log(`saved ${out.count} notes as ${out.commit.slice(0, 7)}`, 'ok');
      log('The site is rebuilding.', 'ok');
    } catch (err) {
      log(err.message, 'err');
    } finally {
      save.disabled = false;
    }
  });
  host.appendChild(save);
}

$('add-note').addEventListener('click', () => {
  notes.push({ id: '', kind: 'note', title: '', body: [], links: [] });
  renderNotes();
});

/* ---- upload ---- */

$('drop').addEventListener('click', () => $('file').click());
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  takeFiles([...e.dataTransfer.files]);
});
$('file').addEventListener('change', (e) => takeFiles([...e.target.files]));

function takeFiles(list) {
  files = list;
  $('thumbs').innerHTML = '';
  for (const f of files) {
    const fig = document.createElement('figure');
    const el = f.type.startsWith('video') ? document.createElement('video') : document.createElement('img');
    el.src = URL.createObjectURL(f);
    if (el.tagName === 'VIDEO') { el.muted = true; el.playsInline = true; }
    const cap = document.createElement('figcaption');
    cap.textContent = `${(f.size / 1048576).toFixed(1)}MB`;
    fig.append(el, cap);
    $('thumbs').appendChild(fig);
  }
  $('go').disabled = files.length === 0;
}

// A 3MB phone photo becomes about 300KB, which keeps every request inside the
// serverless body limit and matches what the build would produce anyway.
function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => reject(new Error(`could not read ${file.name}`));
    img.src = URL.createObjectURL(file);
  });
}

// A video needs a still for the wall. There is no ffmpeg on the server, so the frame
// is grabbed here — a little way in, because timelapses open on a blank canvas.
function posterFrame(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => { v.currentTime = Math.min(v.duration * 0.4, v.duration - 0.1); };
    v.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d').drawImage(v, 0, 0);
      URL.revokeObjectURL(v.src);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster failed'))), 'image/jpeg', 0.9);
    };
    v.onerror = () => reject(new Error('could not read the video'));
    v.src = URL.createObjectURL(file);
  });
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.onerror = () => reject(new Error('read failed'));
  r.readAsDataURL(blob);
});

async function uploadBlob(blob, type, name) {
  if (blob.size > MAX_BYTES) {
    throw new Error(`${name} is ${(blob.size / 1048576).toFixed(1)}MB after processing — too large`);
  }
  const { sha } = await api('/api/upload', {
    method: 'POST',
    body: { action: 'blob', type, data: await toBase64(blob) },
  });
  return sha;
}

$('go').addEventListener('click', async () => {
  clearLog();
  $('go').disabled = true;
  const prog = $('prog');

  try {
    if (!$('title').value.trim()) throw new Error('give it a title');

    const video = files.find((f) => f.type.startsWith('video'));
    const images = files.filter((f) => !f.type.startsWith('video'));
    const steps = images.length + (video ? 2 : 0) + 1;
    let done = 0;
    const tick = () => { prog.style.width = `${Math.round((++done / steps) * 100)}%`; };

    const sheets = [];
    for (const f of images) {
      log(`processing ${f.name}…`);
      sheets.push({ sha: await uploadBlob(await downscale(f), 'image/jpeg', f.name) });
      tick();
    }

    let videoRef = null;
    let posterSha = null;
    if (video) {
      log('grabbing a poster frame…');
      posterSha = await uploadBlob(await posterFrame(video), 'image/jpeg', 'poster');
      tick();
      log(`uploading ${video.name}…`);
      videoRef = { sha: await uploadBlob(video, video.type, video.name) };
      tick();
      if (!sheets.length) sheets.push({ sha: posterSha });
    }

    log('committing…');
    const out = await api('/api/upload', {
      method: 'POST',
      body: {
        action: 'commit',
        title: $('title').value.trim(),
        label: $('label').value.trim(),
        sheets,
        video: videoRef,
        posterSha,
      },
    });
    tick();
    log(`committed ${out.commit.slice(0, 7)} as "${out.id}"`, 'ok');
    log('The site is rebuilding. It will be on the wall shortly.', 'ok');
    $('title').value = '';
    $('label').value = '';
    takeFiles([]);
  } catch (err) {
    log(err.message, 'err');
    prog.style.width = '0';
  } finally {
    $('go').disabled = files.length === 0;
  }
});

/* ---- boot ---- */

// A key already in sessionStorage means this tab signed in earlier; verify it rather
// than trusting it, so a changed password does not leave a dead dashboard open.
if (key) {
  $('key').value = key;
  signIn();
}
