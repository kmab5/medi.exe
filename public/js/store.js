// Persistence for wall state. Talks to /api when it is available and falls back to
// localStorage otherwise, so the wall is fully functional as a static deploy with no
// backend at all — you just lose the shared sticker layer.

const VISITOR_KEY = 'medi.visitor';
const LAYOUT_KEY = 'medi.layout';
const STICKER_KEY = 'medi.stickers';

function visitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

let apiAvailable = null;

async function api(path, options) {
  if (apiAvailable === false) throw new Error('api unavailable');
  try {
    const res = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-visitor': visitorId() },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    // The endpoint answers 200 with configured:false when no shared store is set
    // up. Treat that as "there is no API" so we stop asking on every save.
    if (json.configured === false) {
      apiAvailable = false;
      throw new Error('storage not configured');
    }
    apiAvailable = true;
    return json;
  } catch (err) {
    apiAvailable = false;
    throw err;
  }
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode. Losing persistence is survivable; crashing is not.
  }
}

// Debounced so dragging forty pieces around does not produce forty writes.
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const store = {
  async loadLayout() {
    try {
      const { layout } = await api('/api/layout');
      return layout ?? {};
    } catch {
      return readLocal(LAYOUT_KEY, {});
    }
  },

  saveLayout: debounce(async (layout) => {
    writeLocal(LAYOUT_KEY, layout);
    try {
      await api('/api/layout', { method: 'POST', body: JSON.stringify({ layout }) });
    } catch {
      // Local copy already written.
    }
  }, 600),

  async loadStickers() {
    try {
      const { stickers } = await api('/api/stickers');
      return stickers ?? [];
    } catch {
      return readLocal(STICKER_KEY, []);
    }
  },

  async addSticker(sticker) {
    const local = readLocal(STICKER_KEY, []);
    local.push(sticker);
    writeLocal(STICKER_KEY, local);
    try {
      await api('/api/stickers', { method: 'POST', body: JSON.stringify(sticker) });
    } catch {
      // Sticker still exists for this visitor, just not shared.
    }
  },
};
