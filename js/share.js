// Share links carry the whole map in the URL fragment, which is never sent to
// a server. Data is deflate-compressed when the browser supports it.

import { wrapForExport } from './store.js';

const HASH_KEY = 'm=';

function toB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// Strip empty/default fields so links stay short.
function slim(map) {
  const clean = (o) => {
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) continue;
      r[k] = v;
    }
    return r;
  };
  return {
    name: map.name,
    notes: map.notes || undefined,
    states: map.states.map((s) => clean({ ...s, micro: s.micro.map(clean) })),
    transitions: map.transitions.map(clean),
  };
}

export async function encodeMap(map) {
  const json = JSON.stringify(slim(map));
  const bytes = new TextEncoder().encode(json);
  if ('CompressionStream' in self) {
    try {
      return 'z' + toB64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
    } catch { /* fall through */ }
  }
  return 'j' + toB64Url(bytes);
}

export async function decodeMap(payload) {
  const kind = payload[0];
  const bytes = fromB64Url(payload.slice(1));
  let raw;
  if (kind === 'z') {
    if (!('DecompressionStream' in self)) throw new Error('This browser cannot open compressed share links.');
    raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind === 'j') {
    raw = bytes;
  } else {
    throw new Error('Unrecognised share link.');
  }
  return JSON.parse(new TextDecoder().decode(raw));
}

export async function shareUrl(map) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = HASH_KEY + (await encodeMap(map));
  return url.toString();
}

export function readShareHash() {
  const h = location.hash.slice(1);
  return h.startsWith(HASH_KEY) ? h.slice(HASH_KEY.length) : null;
}

export function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

export function fileNameFor(map) {
  const base = map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `${base}.jjmap.json`;
}

export function mapFile(map) {
  const json = JSON.stringify(wrapForExport(map), null, 2);
  return new File([json], fileNameFor(map), { type: 'application/json' });
}

export function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
