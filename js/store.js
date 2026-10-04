// Persistence layer. Every key this app touches starts with PREFIX; nothing
// else in localStorage is ever read, written, or cleared.

export const PREFIX = 'jjmap:v1:';
const KEY_INDEX = PREFIX + 'index';
const KEY_PREFS = PREFIX + 'prefs';
const mapKey = (id) => PREFIX + 'map:' + id;

export const FORMAT = 'jjmap';
export const FORMAT_VERSION = 1;

let errorHandler = () => {};
export function onStorageError(fn) { errorHandler = fn; }

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    errorHandler(err);
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function uid(prefix = '') {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return prefix + rand[0].toString(36) + rand[1].toString(36).slice(0, 4);
}

// ---------- index & prefs ----------

export function listMaps() {
  const idx = read(KEY_INDEX, []);
  return Array.isArray(idx) ? idx : [];
}

function saveIndex(idx) { return write(KEY_INDEX, idx); }

export function getPrefs() { return read(KEY_PREFS, {}) || {}; }

let prefsTimer = 0;
let pendingPrefs = null;
export function setPrefs(patch) {
  pendingPrefs = { ...(pendingPrefs || getPrefs()), ...patch };
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(flushPrefs, 400);
}
function flushPrefs() {
  if (!pendingPrefs) return;
  const current = getPrefs();
  // Skip the write entirely when nothing changed.
  if (JSON.stringify(current) !== JSON.stringify(pendingPrefs)) write(KEY_PREFS, pendingPrefs);
  pendingPrefs = null;
}

// ---------- maps ----------

export function loadMap(id) {
  const m = read(mapKey(id), null);
  return m ? normalizeMap(m) : null;
}

// Debounced save: rapid edits (dragging graph nodes, typing) collapse into one write.
const pendingMaps = new Map();
let saveTimer = 0;

export function saveMap(map, { immediate = false } = {}) {
  pendingMaps.set(map.id, map);
  clearTimeout(saveTimer);
  if (immediate) flush();
  else saveTimer = setTimeout(flush, 350);
}

export function flush() {
  clearTimeout(saveTimer);
  let ok = true;
  if (pendingMaps.size) {
    const idx = listMaps();
    for (const map of pendingMaps.values()) {
      if (!write(mapKey(map.id), map)) { ok = false; continue; }
      const entry = { id: map.id, name: map.name, updated: map.updated };
      const i = idx.findIndex((e) => e.id === map.id);
      if (i >= 0) idx[i] = entry; else idx.push(entry);
    }
    pendingMaps.clear();
    saveIndex(idx);
  }
  flushPrefs();
  return ok;
}

export function deleteMap(id) {
  pendingMaps.delete(id);
  remove(mapKey(id));
  saveIndex(listMaps().filter((e) => e.id !== id));
}

// Bytes used by this app's keys only (UTF-16 => 2 bytes per code unit).
export function usage() {
  let bytes = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        keys++;
        bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    }
  } catch { /* storage unavailable */ }
  return { bytes, keys };
}

export function clearAll() {
  const doomed = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
  } catch { /* ignore */ }
  doomed.forEach(remove);
  pendingMaps.clear();
  pendingPrefs = null;
}

// ---------- model ----------

export const TYPES = [
  ['transition', 'Transition'],
  ['sweep', 'Sweep'],
  ['pass', 'Guard pass'],
  ['submission', 'Submission'],
  ['escape', 'Escape'],
  ['takedown', 'Takedown'],
  ['guardpull', 'Guard pull'],
  ['backtake', 'Back take'],
  ['setup', 'Setup / grip'],
  ['other', 'Other'],
];
export const STATUSES = [
  ['agame', 'A-game'],
  ['working', 'Working'],
  ['learning', 'Learning'],
  ['failing', 'Failing'],
];
export const CATEGORIES = [
  ['neutral', 'Neutral'],
  ['bottom', 'Bottom'],
  ['top', 'Top'],
  ['scramble', 'Scramble'],
];
const typeSet = new Set(TYPES.map((t) => t[0]));
const statusSet = new Set(STATUSES.map((t) => t[0]));
const catSet = new Set(CATEGORIES.map((t) => t[0]));

export function newMap(name = 'Untitled map') {
  const now = Date.now();
  return { id: uid('m'), name, notes: '', created: now, updated: now, states: [], transitions: [] };
}

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Validates and repairs a map from any source (storage, file, share link).
// Unknown fields are dropped; dangling references are nulled.
export function normalizeMap(raw, { freshId = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a map');
  const now = Date.now();
  const seenIds = new Set();
  const safeId = (v, p) => {
    let id = typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : uid(p);
    while (seenIds.has(id)) id = uid(p);
    seenIds.add(id);
    return id;
  };

  const states = (Array.isArray(raw.states) ? raw.states : []).slice(0, 2000).map((s) => {
    const st = {
      id: safeId(s?.id, 's'),
      name: str(s?.name, 120) || 'Unnamed state',
      category: catSet.has(s?.category) ? s.category : 'neutral',
      notes: str(s?.notes),
      micro: (Array.isArray(s?.micro) ? s.micro : []).slice(0, 200).map((m) => ({
        id: safeId(m?.id, 'u'),
        name: str(m?.name, 120) || 'Unnamed',
        notes: str(m?.notes),
      })),
    };
    const x = num(s?.x), y = num(s?.y);
    if (x !== undefined && y !== undefined) { st.x = x; st.y = y; }
    return st;
  });

  const stateById = new Map(states.map((s) => [s.id, s]));
  const fixRef = (r) => {
    const st = r && stateById.get(r.state);
    if (!st) return null;
    const micro = st.micro.some((m) => m.id === r.micro) ? r.micro : null;
    return { state: st.id, micro };
  };

  const transitions = (Array.isArray(raw.transitions) ? raw.transitions : []).slice(0, 5000).map((t) => ({
    id: safeId(t?.id, 't'),
    name: str(t?.name, 160) || 'Unnamed technique',
    type: typeSet.has(t?.type) ? t.type : 'transition',
    status: statusSet.has(t?.status) ? t.status : 'learning',
    from: fixRef(t?.from),
    to: fixRef(t?.to),
    failsTo: fixRef(t?.failsTo),
    failNotes: str(t?.failNotes),
    backups: Array.isArray(t?.backups) ? t.backups.filter((b) => typeof b === 'string') : [],
    notes: str(t?.notes),
    link: /^https?:\/\//i.test(t?.link || '') ? str(t.link, 2000) : '',
  }));
  const tIds = new Set(transitions.map((t) => t.id));
  for (const t of transitions) t.backups = [...new Set(t.backups)].filter((b) => tIds.has(b) && b !== t.id);

  return {
    id: freshId ? uid('m') : (typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : uid('m')),
    name: str(raw.name, 120) || 'Untitled map',
    notes: str(raw.notes),
    created: num(raw.created) ?? now,
    updated: num(raw.updated) ?? now,
    states,
    transitions,
  };
}

export function wrapForExport(map) {
  return { format: FORMAT, version: FORMAT_VERSION, exported: new Date().toISOString(), map };
}

// Accepts a single-map export, a full backup, or a bare map object.
export function unwrapImport(data) {
  if (data?.format === FORMAT + '-backup' && Array.isArray(data.maps)) return data.maps;
  if (data?.format === FORMAT && data.map) return [data.map];
  if (data?.states) return [data];
  throw new Error('This file is not a Jiu-Jitsu Map export.');
}
