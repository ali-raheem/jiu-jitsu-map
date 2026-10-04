// Flow graph: force-directed auto layout, SVG rendering, drag / pan / zoom.

import { TYPES } from './store.js';

const NS = 'http://www.w3.org/2000/svg';
const NODE_H = 46;
const MARKER_KINDS = [...TYPES.map((t) => t[0]), 'mixed', 'fail'];
let instanceCounter = 0;

function el(tag, attrs = {}, ...children) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of children) if (c != null) e.append(c);
  return e;
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function nodeSize(st) {
  return { w: Math.round(Math.max(110, Math.min(250, st.name.length * 7.8 + 32))), h: NODE_H };
}

// ---------- layout ----------

function layoutEdges(map) {
  const out = [];
  for (const t of map.transitions) {
    if (!t.from) continue;
    if (t.to && t.to.state !== t.from.state) out.push([t.from.state, t.to.state]);
    if (t.failsTo && t.failsTo.state !== t.from.state) out.push([t.from.state, t.failsTo.state]);
  }
  return out;
}

// Positions any state that has no coordinates (or all states when `all`).
// Already-placed states stay fixed so a user's manual arrangement survives.
export function autoLayout(map, { all = false } = {}) {
  const nodes = map.states;
  const free = nodes.filter((n) => all || n.x === undefined);
  if (!free.length) return false;
  const fixed = new Set(nodes.filter((n) => !free.includes(n)));

  let cx = 0, cy = 0;
  if (fixed.size) {
    for (const n of fixed) { cx += n.x; cy += n.y; }
    cx /= fixed.size; cy /= fixed.size;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = layoutEdges(map).map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);

  // Seed: next to a placed neighbour if there is one, else on a ring.
  const R = 90 * Math.sqrt(nodes.length) + 60;
  free.forEach((n, i) => {
    const nb = edges.find(([a, b]) => (a === n && fixed.has(b)) || (b === n && fixed.has(a)));
    const anchor = nb ? (nb[0] === n ? nb[1] : nb[0]) : null;
    const ang = (i / free.length) * Math.PI * 2;
    n.x = (anchor ? anchor.x : cx) + Math.cos(ang) * (anchor ? 160 : R);
    n.y = (anchor ? anchor.y : cy) + Math.sin(ang) * (anchor ? 120 : R);
  });

  const k = 190;
  const iterations = 350;
  const freeSet = new Set(free);
  for (let it = 0; it < iterations; it++) {
    const temp = 40 * (1 - it / iterations) + 1;
    const disp = new Map(nodes.map((n) => [n, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = (a.y - b.y) * 1.6; // boxes are wide: push harder vertically
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.5; }
        const f = (k * k) / d;
        const da = disp.get(a), db = disp.get(b);
        da.x += (dx / d) * f; da.y += (dy / d) * f;
        db.x -= (dx / d) * f; db.y -= (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (d * d) / k;
      const da = disp.get(a), db = disp.get(b);
      da.x -= (dx / d) * f; da.y -= (dy / d) * f;
      db.x += (dx / d) * f; db.y += (dy / d) * f;
    }
    for (const n of free) {
      const dv = disp.get(n);
      dv.x += (cx - n.x) * 0.05 * k / 100;
      dv.y += (cy - n.y) * 0.05 * k / 100;
      const d = Math.hypot(dv.x, dv.y) || 1;
      n.x += (dv.x / d) * Math.min(d, temp);
      n.y += (dv.y / d) * Math.min(d, temp);
    }
  }
  for (const n of freeSet) { n.x = Math.round(n.x); n.y = Math.round(n.y); }
  return true;
}

// ---------- drawing ----------

function edgeGroups(map, showFails) {
  const groups = new Map();
  const add = (key, from, to, kind, t) => {
    if (!groups.has(key)) groups.set(key, { from, to, kind, items: [] });
    groups.get(key).items.push(t);
  };
  for (const t of map.transitions) {
    if (!t.from) continue;
    if (t.to) add(`${t.from.state}>${t.to.state}`, t.from.state, t.to.state, 'move', t);
    if (showFails && t.failsTo) add(`f:${t.from.state}>${t.failsTo.state}`, t.from.state, t.failsTo.state, 'fail', t);
  }
  return [...groups.values()];
}

function clip(cx, cy, w, h, tx, ty, pad = 3) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const t = Math.min((w / 2 + pad) / Math.abs(dx || 1e-9), (h / 2 + pad) / Math.abs(dy || 1e-9));
  return [cx + dx * t, cy + dy * t];
}

function groupLabel(g) {
  const names = g.items.map((t) => t.name);
  const prefix = g.kind === 'fail' ? '✗ ' : '';
  if (names.length === 1) return prefix + truncate(names[0], 30);
  if (names.length === 2 && names.join(', ').length <= 34) return prefix + names.join(', ');
  return prefix + truncate(names[0], 22) + ` +${names.length - 1}`;
}

function buildDefs(prefix) {
  const defs = el('defs');
  for (const kind of MARKER_KINDS) {
    defs.append(el('marker', {
      id: `${prefix}-${kind}`, class: `mk mk-${kind}`, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse',
    }, el('path', { d: 'M0,0 L10,5 L0,10 z' })));
  }
  return defs;
}

function drawEdges(layer, map, opts, prefix) {
  layer.replaceChildren();
  const byId = new Map(map.states.map((s) => [s.id, s]));
  const labels = el('g', { class: 'edge-labels' });
  for (const g of edgeGroups(map, opts.showFails)) {
    const a = byId.get(g.from), b = byId.get(g.to);
    if (!a || !b) continue;
    const types = new Set(g.items.map((t) => t.type));
    const kind = g.kind === 'fail' ? 'fail' : types.size === 1 ? [...types][0] : 'mixed';
    const allFailing = g.kind === 'move' && g.items.every((t) => t.status === 'failing');
    const cls = `edge e-${kind}${allFailing ? ' is-failing' : ''}`;
    const sa = nodeSize(a), sb = nodeSize(b);
    let d, lx, ly;
    if (a === b) {
      // Self-loop above (moves) or below (failures) the node.
      const dir = g.kind === 'fail' ? 1 : -1;
      const y0 = a.y + dir * (sa.h / 2 + 2);
      const off = g.kind === 'fail' ? -18 : 18;
      d = `M${a.x - 20 + off},${y0} C${a.x - 50 + off},${y0 + dir * 52} ${a.x + 50 + off},${y0 + dir * 52} ${a.x + 20 + off},${y0}`;
      lx = a.x + off; ly = y0 + dir * 46;
    } else {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = g.kind === 'fail' ? -38 : 26;
      const qx = mx + (-dy / len) * bend, qy = my + (dx / len) * bend;
      const [x1, y1] = clip(a.x, a.y, sa.w, sa.h, qx, qy);
      const [x2, y2] = clip(b.x, b.y, sb.w, sb.h, qx, qy, 5);
      d = `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`;
      lx = 0.25 * x1 + 0.5 * qx + 0.25 * x2;
      ly = 0.25 * y1 + 0.5 * qy + 0.25 * y2;
    }
    const title = g.items.map((t) => t.name).join('\n');
    layer.append(el('path', { d, class: cls, 'marker-end': `url(#${prefix}-${kind})` }, el('title', {}, title)));
    labels.append(el('text', { x: lx, y: ly + 4, class: `edge-label el-${kind}`, 'text-anchor': 'middle' },
      groupLabel(g), el('title', {}, title)));
  }
  layer.append(labels);
}

function drawNodes(layer, map, opts) {
  layer.replaceChildren();
  const finishes = new Map();
  for (const t of map.transitions) {
    if (t.from && !t.to && t.type === 'submission') finishes.set(t.from.state, (finishes.get(t.from.state) || 0) + 1);
  }
  for (const st of map.states) {
    const { w, h } = nodeSize(st);
    const parts = [];
    if (st.micro.length) parts.push(`${st.micro.length} micro`);
    if (finishes.get(st.id)) parts.push(`${finishes.get(st.id)} finish${finishes.get(st.id) > 1 ? 'es' : ''}`);
    const g = el('g', {
      class: `node cat-${st.category}${opts.selectedId === st.id ? ' selected' : ''}`,
      transform: `translate(${st.x},${st.y})`, 'data-id': st.id,
      tabindex: opts.interactive ? 0 : null, role: opts.interactive ? 'button' : null,
      'aria-label': opts.interactive ? `State ${st.name}` : null,
    },
    el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 10 }),
    el('text', { class: 'node-label', 'text-anchor': 'middle', y: parts.length ? -1 : 5 }, truncate(st.name, 30)),
    parts.length ? el('text', { class: 'node-sub', 'text-anchor': 'middle', y: 14 }, parts.join(' · ')) : null);
    layer.append(g);
  }
}

function bounds(map) {
  if (!map.states.length) return { x: -200, y: -150, w: 400, h: 300 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of map.states) {
    const { w, h } = nodeSize(st);
    x0 = Math.min(x0, st.x - w / 2); x1 = Math.max(x1, st.x + w / 2);
    y0 = Math.min(y0, st.y - h / 2 - 60); y1 = Math.max(y1, st.y + h / 2 + 60);
  }
  const pad = 40;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

// A self-contained, non-interactive SVG (used for printing).
export function staticSvg(map, { showFails = true } = {}) {
  autoLayout(map);
  const prefix = `jjg${++instanceCounter}`;
  const b = bounds(map);
  const svg = el('svg', { class: 'flow-graph static', viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`, role: 'img', 'aria-label': `Flow graph of ${map.name}` });
  const edges = el('g'), nodes = el('g');
  svg.append(buildDefs(prefix), edges, nodes);
  drawEdges(edges, map, { showFails }, prefix);
  drawNodes(nodes, map, {});
  return svg;
}

// ---------- interactive view ----------

export class GraphView {
  constructor(svg, { onSelect, onMoved }) {
    this.svg = svg;
    this.onSelect = onSelect;
    this.onMoved = onMoved;
    this.prefix = `jjg${++instanceCounter}`;
    this.map = null;
    this.opts = { showFails: true, selectedId: null, interactive: true };
    this.vb = null;
    this.edges = el('g');
    this.nodes = el('g');
    svg.replaceChildren(buildDefs(this.prefix), this.edges, this.nodes);
    this.pointers = new Map();
    this.bind();
  }

  setMap(map, opts = {}) {
    const changedMap = this.map?.id !== map.id;
    this.map = map;
    Object.assign(this.opts, opts);
    const placed = autoLayout(map);
    this.render();
    if (changedMap || !this.vb) this.fit();
    return placed;
  }

  render() {
    if (!this.map) return;
    drawEdges(this.edges, this.map, this.opts, this.prefix);
    drawNodes(this.nodes, this.map, this.opts);
  }

  relayout() {
    autoLayout(this.map, { all: true });
    this.render();
    this.fit();
  }

  fit() {
    if (!this.map) return;
    this.setViewBox(bounds(this.map));
  }

  setViewBox(b) {
    this.vb = b;
    this.svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
  }

  zoom(factor, cx, cy) {
    const v = this.vb;
    if (cx === undefined) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
    const w = Math.min(Math.max(v.w * factor, 150), 20000);
    const f = w / v.w;
    this.setViewBox({ x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w, h: v.h * f });
  }

  toSvg(clientX, clientY, inverse = this.svg.getScreenCTM()?.inverse()) {
    const p = new DOMPoint(clientX, clientY);
    return inverse ? p.matrixTransform(inverse) : p;
  }

  bind() {
    const svg = this.svg;
    let drag = null;

    svg.addEventListener('pointerdown', (e) => {
      if (!this.map || (e.pointerType === 'mouse' && e.button !== 0)) return;
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const inv = svg.getScreenCTM()?.inverse();
      const start = this.toSvg(e.clientX, e.clientY, inv);
      if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        drag = { mode: 'pinch', dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
        return;
      }
      const nodeEl = e.target.closest('.node');
      const st = nodeEl && this.map.states.find((s) => s.id === nodeEl.dataset.id);
      drag = st
        ? { mode: 'node', st, nodeEl, inv, start, ox: st.x, oy: st.y, moved: false, sx: e.clientX, sy: e.clientY }
        : { mode: 'pan', inv, start, vb: { ...this.vb }, sx: e.clientX, sy: e.clientY, moved: false };
    });

    svg.addEventListener('pointermove', (e) => {
      if (!drag || !this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.mode === 'pinch') {
        const [p1, p2] = [...this.pointers.values()];
        if (!p2) return;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const c = this.toSvg((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        if (dist > 0) this.zoom(drag.dist / dist, c.x, c.y);
        drag.dist = dist;
        return;
      }
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const p = this.toSvg(e.clientX, e.clientY, drag.inv);
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (drag.mode === 'node') {
        drag.st.x = Math.round(drag.ox + dx);
        drag.st.y = Math.round(drag.oy + dy);
        drag.nodeEl.setAttribute('transform', `translate(${drag.st.x},${drag.st.y})`);
        drawEdges(this.edges, this.map, this.opts, this.prefix);
      } else {
        this.setViewBox({ ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy });
      }
    });

    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (!drag) return;
      if (drag.mode === 'node') {
        if (drag.moved) this.onMoved?.(drag.st);
        else if (e.type === 'pointerup') this.onSelect?.(drag.st.id);
      }
      drag = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', (e) => {
      if (!this.vb) return;
      e.preventDefault();
      const c = this.toSvg(e.clientX, e.clientY);
      this.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) / 400), c.x, c.y);
    }, { passive: false });

    svg.addEventListener('keydown', (e) => {
      const nodeEl = e.target.closest?.('.node');
      if (nodeEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.onSelect?.(nodeEl.dataset.id);
      }
    });
  }
}
