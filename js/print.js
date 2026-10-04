// Builds the printer-friendly document into #print-view.

import { h, fill } from './ui.js';
import { staticSvg } from './graph.js';
import { CATEGORIES, TYPES, STATUSES } from './store.js';

const label = (pairs) => Object.fromEntries(pairs);
const TYPE = label(TYPES), STATUS = label(STATUSES), CAT = label(CATEGORIES);
const CAT_ORDER = CATEGORIES.map((c) => c[0]);

export const DEFAULT_PRINT_OPTS = { graph: true, notes: true, status: true, failing: true };

export function renderPrint(map, opts = DEFAULT_PRINT_OPTS) {
  const root = document.getElementById('print-view');
  const stateById = new Map(map.states.map((s) => [s.id, s]));
  const tById = new Map(map.transitions.map((t) => [t.id, t]));
  const refText = (r, finish) => {
    if (!r) return finish ? 'Finish' : '—';
    const st = stateById.get(r.state);
    if (!st) return '—';
    const m = r.micro && st.micro.find((x) => x.id === r.micro);
    return m ? `${st.name} · ${m.name}` : st.name;
  };
  const microName = (st, id) => st.micro.find((m) => m.id === id)?.name;

  const states = [...map.states].sort((a, b) =>
    CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));

  const techRow = (t, st) => h('tr', { class: t.status === 'failing' ? 'row-failing' : null },
    h('td', {},
      h('strong', {}, t.name),
      t.from.micro ? h('div', { class: 'p-sub' }, `from ${microName(st, t.from.micro)}`) : null,
      opts.notes && t.notes ? h('div', { class: 'p-note' }, t.notes) : null),
    h('td', {}, TYPE[t.type]),
    h('td', {}, refText(t.to, t.type === 'submission')),
    h('td', {},
      t.failsTo ? refText(t.failsTo) : '',
      opts.notes && t.failNotes ? h('div', { class: 'p-note' }, t.failNotes) : null),
    h('td', {}, t.backups.map((id) => tById.get(id)?.name).filter(Boolean).join(', ')),
    opts.status ? h('td', {}, h('span', { class: `p-status s-${t.status}` }, STATUS[t.status])) : null);

  const head = () => h('thead', {}, h('tr', {},
    h('th', {}, 'Technique'), h('th', {}, 'Type'), h('th', {}, 'Leads to'),
    h('th', {}, 'If it fails'), h('th', {}, 'Backups'), opts.status ? h('th', {}, 'Status') : null));

  const sections = states.map((st) => {
    const out = map.transitions.filter((t) => t.from?.state === st.id);
    return h('section', { class: 'p-state' },
      h('h2', {}, st.name, ' ', h('small', {}, CAT[st.category])),
      opts.notes && st.notes ? h('p', { class: 'p-note' }, st.notes) : null,
      st.micro.length ? h('p', { class: 'p-micro' }, h('b', {}, 'Microstates: '),
        st.micro.map((m, i) => [i ? '; ' : '', m.name, opts.notes && m.notes ? ` (${m.notes})` : ''])) : null,
      out.length
        ? h('table', { class: 'p-table' }, head(), h('tbody', {}, out.map((t) => techRow(t, st))))
        : h('p', { class: 'p-empty' }, 'No techniques mapped from here yet.'));
  });

  const failing = map.transitions.filter((t) => t.status === 'failing' || t.failsTo || t.backups.length);
  const failSection = opts.failing && failing.length ? h('section', { class: 'p-state p-fail' },
    h('h2', {}, 'When it goes wrong'),
    h('table', { class: 'p-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Technique'), h('th', {}, 'From'), h('th', {}, 'You end up'), h('th', {}, 'Go to'))),
      h('tbody', {}, failing.map((t) => h('tr', {},
        h('td', {}, h('strong', {}, t.name), t.status === 'failing' ? ' (failing)' : ''),
        h('td', {}, refText(t.from)),
        h('td', {}, t.failsTo ? refText(t.failsTo) : '—'),
        h('td', {}, t.backups.map((id) => tById.get(id)).filter(Boolean).map((b) => `${b.name} → ${refText(b.to, b.type === 'submission')}`).join('; ') || '—')))))) : null;

  fill(root,
    h('header', { class: 'p-head' },
      h('h1', {}, map.name),
      h('p', { class: 'p-meta' }, `${map.states.length} states · ${map.transitions.length} techniques · printed ${new Date().toLocaleDateString()}`),
      opts.notes && map.notes ? h('p', { class: 'p-note' }, map.notes) : null),
    opts.graph && map.states.length ? h('figure', { class: 'p-graph' }, staticSvg(structuredClone(map))) : null,
    sections,
    failSection,
    h('footer', { class: 'p-foot' }, 'Made with Jiu-Jitsu Map'));
}
