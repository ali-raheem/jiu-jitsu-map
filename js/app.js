import * as store from './store.js';
import { h, fill, modal, confirmDialog, toast, options, field, formatBytes } from './ui.js';
import { GraphView } from './graph.js';
import { renderPrint, DEFAULT_PRINT_OPTS } from './print.js';
import * as share from './share.js';
import { sampleMap } from './sample.js';

const APP_VERSION = '1.0.1';
const CACHE_PREFIX = 'jjmap-static-';

const $ = (sel) => document.querySelector(sel);
const TYPE = Object.fromEntries(store.TYPES);
const STATUS = Object.fromEntries(store.STATUSES);
const CAT = Object.fromEntries(store.CATEGORIES);
const CAT_ORDER = store.CATEGORIES.map((c) => c[0]);

const app = {
  map: null,
  view: 'states',
  selected: null,
  micro: null,
  stateFilter: '',
  tech: { q: '', type: '', status: '', state: '' },
  showFails: true,
  printOpts: { ...DEFAULT_PRINT_OPTS },
  graph: null,
  installPrompt: null,
};

// ---------- helpers ----------

const stateById = (id) => app.map.states.find((s) => s.id === id);
const techById = (id) => app.map.transitions.find((t) => t.id === id);

function refText(ref, finish = false) {
  if (!ref) return finish ? 'Finish' : '—';
  const st = stateById(ref.state);
  if (!st) return '—';
  const m = ref.micro && st.micro.find((x) => x.id === ref.micro);
  return m ? `${st.name} · ${m.name}` : st.name;
}

function refLink(ref, finish = false) {
  if (!ref) return h('span', { class: finish ? 'finish' : 'muted' }, finish ? 'Finish' : 'not mapped');
  return h('button', {
    type: 'button', class: 'linklike',
    onclick: () => selectState(ref.state, ref.micro),
  }, refText(ref));
}

function selectState(id, micro = null) {
  app.selected = id;
  app.micro = micro;
  setView('states');
  store.setPrefs({ selected: id });
  requestAnimationFrame(() => $('#state-detail').scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

// Every mutation goes through here: one save, one render, optional undo.
function commit(mutate, { undo } = {}) {
  const before = undo ? JSON.stringify(app.map) : null;
  const replaced = mutate(app.map);
  if (replaced) app.map = replaced;
  app.map.updated = Date.now();
  store.saveMap(app.map);
  requestPersistence();
  render();
  if (undo) {
    toast(undo, {
      action: 'Undo',
      duration: 7000,
      onAction: () => {
        app.map = JSON.parse(before);
        app.map.updated = Date.now();
        store.saveMap(app.map);
        render();
      },
    });
  }
}

// Drops references to anything that no longer exists.
const repair = (map) => store.normalizeMap(map);

// ---------- persistent storage ----------

let persistTries = 0;
async function requestPersistence(force = false) {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    if (!force && persistTries >= 2) return false;
    persistTries++;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ---------- rendering ----------

function render() {
  renderMapPicker();
  if (app.view === 'states') renderStates();
  else if (app.view === 'techniques') renderTechniques();
  else if (app.view === 'graph') renderGraph();
  document.title = `${app.map.name} · Jiu-Jitsu Map`;
}

function setView(view) {
  app.view = view;
  for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
    const on = tab.dataset.view === view;
    tab.setAttribute('aria-selected', on);
    tab.tabIndex = on ? 0 : -1;
  }
  for (const sec of document.querySelectorAll('main > .view')) sec.hidden = sec.id !== `view-${view}`;
  store.setPrefs({ view });
  render();
}

function renderMapPicker() {
  const sel = $('#map-select');
  const idx = store.listMaps();
  if (!idx.some((e) => e.id === app.map.id)) idx.push({ id: app.map.id, name: app.map.name });
  sel.replaceChildren(...idx
    .map((e) => (e.id === app.map.id ? { ...e, name: app.map.name } : e))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => h('option', { value: e.id }, e.name)));
  sel.value = app.map.id;
}

// ----- states view -----

function renderStates() {
  const map = app.map;
  if (app.selected && !stateById(app.selected)) app.selected = null;
  if (!app.selected && map.states.length) app.selected = map.states[0].id;

  const q = app.stateFilter.trim().toLowerCase();
  const counts = new Map();
  for (const t of map.transitions) if (t.from) counts.set(t.from.state, (counts.get(t.from.state) || 0) + 1);

  const list = $('#state-list');
  list.replaceChildren();
  for (const cat of CAT_ORDER) {
    const items = map.states
      .filter((s) => s.category === cat && (!q || s.name.toLowerCase().includes(q) || s.micro.some((m) => m.name.toLowerCase().includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) continue;
    list.append(h('li', { class: 'list-group' }, CAT[cat]));
    for (const st of items) {
      list.append(h('li', {},
        h('button', {
          type: 'button',
          class: `state-item cat-${st.category}${st.id === app.selected ? ' active' : ''}`,
          'aria-current': st.id === app.selected ? 'true' : null,
          onclick: () => { app.selected = st.id; app.micro = null; store.setPrefs({ selected: st.id }); renderStates(); },
        },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('span', { class: 'state-name' }, st.name),
        h('span', { class: 'count', title: 'Techniques from here' }, counts.get(st.id) || 0))));
    }
  }
  if (!list.children.length) {
    list.append(h('li', { class: 'empty' }, map.states.length ? 'No matches.' : 'No states yet.'));
  }

  renderStateDetail();
}

function renderStateDetail() {
  const box = $('#state-detail');
  const st = app.selected && stateById(app.selected);
  if (!st) {
    box.replaceChildren(h('div', { class: 'empty-state' },
      h('h2', {}, 'Start mapping your game'),
      h('p', {}, 'Add a state (a position like “Closed guard” or “Standing”), then add the techniques that move you between states.'),
      h('button', { type: 'button', class: 'primary', onclick: () => editState() }, '+ Add your first state')));
    return;
  }
  if (app.micro && !st.micro.some((m) => m.id === app.micro)) app.micro = null;

  const out = app.map.transitions.filter((t) => t.from?.state === st.id);
  const incoming = app.map.transitions.filter((t) => t.to?.state === st.id && t.from?.state !== st.id);
  const landing = app.map.transitions.filter((t) => t.failsTo?.state === st.id);

  const groups = [{ id: null, name: 'Anywhere in this state' }, ...st.micro]
    .filter((g) => !app.micro || g.id === null || g.id === app.micro)
    .map((g) => ({ ...g, items: out.filter((t) => (t.from.micro || null) === g.id) }))
    .filter((g) => g.items.length || g.id === app.micro);

  const activeMicro = app.micro && st.micro.find((m) => m.id === app.micro);

  fill(box,
    h('div', { class: 'detail-head' },
      h('div', {},
        h('span', { class: `cat-badge cat-${st.category}` }, CAT[st.category]),
        h('h2', {}, st.name)),
      h('div', { class: 'detail-actions' },
        h('button', { type: 'button', onclick: () => editState(st.id) }, 'Edit'),
        h('button', { type: 'button', class: 'danger-ghost', onclick: () => deleteState(st.id) }, 'Delete'))),
    st.notes ? h('p', { class: 'notes' }, st.notes) : null,

    h('section', { class: 'block' },
      h('div', { class: 'block-head' },
        h('h3', {}, 'Microstates'),
        h('button', { type: 'button', class: 'small', onclick: () => addMicro(st.id) }, '+ Microstate')),
      st.micro.length
        ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by microstate' },
          h('button', { type: 'button', class: `chip${!app.micro ? ' on' : ''}`, 'aria-pressed': !app.micro, onclick: () => { app.micro = null; renderStateDetail(); } }, 'All'),
          st.micro.map((m) => h('button', {
            type: 'button', class: `chip${app.micro === m.id ? ' on' : ''}`, 'aria-pressed': app.micro === m.id,
            onclick: () => { app.micro = app.micro === m.id ? null : m.id; renderStateDetail(); },
          }, m.name)))
        : h('p', { class: 'muted' }, 'Microstates are variations inside this state: grips, posture, frames, who has the underhook…'),
      activeMicro?.notes ? h('p', { class: 'notes' }, activeMicro.notes) : null),

    h('section', { class: 'block' },
      h('div', { class: 'block-head' },
        h('h3', {}, 'Techniques from here'),
        h('button', { type: 'button', class: 'small primary', onclick: () => editTransition(null, { from: { state: st.id, micro: app.micro } }) }, '+ Technique')),
      groups.length
        ? groups.map((g) => h('div', { class: 'tech-group' },
          (st.micro.length ? h('h4', {}, g.name) : null),
          g.items.length ? h('ul', { class: 'tech-list' }, g.items.map((t) => techCard(t, 'out'))) : h('p', { class: 'muted' }, 'Nothing mapped yet.')))
        : h('p', { class: 'muted' }, 'No techniques mapped from this state yet.')),

    incoming.length ? h('section', { class: 'block' },
      h('h3', {}, 'How you get here'),
      h('ul', { class: 'tech-list' }, incoming.map((t) => techCard(t, 'in')))) : null,

    landing.length ? h('section', { class: 'block' },
      h('h3', {}, 'Failures that land here'),
      h('ul', { class: 'tech-list' }, landing.map((t) => techCard(t, 'landing')))) : null,
  );
}

function techCard(t, ctx) {
  const backups = t.backups.map(techById).filter(Boolean);
  const failable = ctx !== 'landing';
  return h('li', { class: `tech s-${t.status}` },
    h('div', { class: 'tech-main' },
      h('span', { class: `type-badge t-${t.type}` }, TYPE[t.type]),
      h('button', { type: 'button', class: 'linklike tech-name', onclick: () => editTransition(t.id) }, t.name),
      h('span', { class: `status s-${t.status}` }, STATUS[t.status])),
    h('div', { class: 'tech-flow' },
      ctx === 'out' ? ['→ ', refLink(t.to, t.type === 'submission')] : ['from ', refLink(t.from), ' → ', ctx === 'in' ? refText(t.to) : refLink(t.to, t.type === 'submission')]),
    failable && (t.failsTo || t.failNotes) ? h('div', { class: 'tech-fail' },
      h('span', { class: 'fail-mark', 'aria-hidden': 'true' }, '✗'), ' If it fails: ',
      t.failsTo ? refLink(t.failsTo) : null,
      t.failNotes ? h('span', { class: 'muted' }, ` — ${t.failNotes}`) : null) : null,
    ctx === 'landing' ? h('div', { class: 'tech-fail' },
      h('span', { class: 'fail-mark', 'aria-hidden': 'true' }, '✗'), ' Lands here when it fails',
      t.failNotes ? h('span', { class: 'muted' }, ` — ${t.failNotes}`) : null) : null,
    backups.length || ctx === 'out' ? h('div', { class: 'tech-backups' },
      backups.length ? ['↳ Backups: ', backups.map((b) => h('button', {
        type: 'button', class: 'chip small', title: `${b.name} → ${refText(b.to, b.type === 'submission')}`,
        onclick: () => (b.from ? selectState(b.from.state, b.from.micro) : editTransition(b.id)),
      }, b.name))] : null,
      ctx === 'out' ? h('button', { type: 'button', class: 'chip add', onclick: () => addBackup(t.id) }, '+ backup') : null) : null,
    t.notes ? h('p', { class: 'tech-notes' }, t.notes) : null,
    t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', class: 'ref-link' }, 'Reference ↗') : null);
}

// ----- techniques view -----

function renderTechniques() {
  const f = app.tech;
  const stSel = $('#tech-state');
  stSel.replaceChildren(h('option', { value: '' }, 'All states'),
    ...[...app.map.states].sort((a, b) => a.name.localeCompare(b.name)).map((s) => h('option', { value: s.id }, s.name)));
  if (f.state && !stateById(f.state)) f.state = '';
  stSel.value = f.state;

  const q = f.q.trim().toLowerCase();
  const rows = app.map.transitions.filter((t) =>
    (!f.type || t.type === f.type) &&
    (!f.status || t.status === f.status) &&
    (!f.state || t.from?.state === f.state || t.to?.state === f.state) &&
    (!q || [t.name, t.notes, t.failNotes, refText(t.from), refText(t.to)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => refText(a.from).localeCompare(refText(b.from)) || a.name.localeCompare(b.name));

  $('#tech-count').textContent = `${rows.length} of ${app.map.transitions.length}`;
  const body = $('#tech-body');
  body.replaceChildren(...rows.map((t) => h('tr', { class: `s-${t.status}` },
    h('td', {}, h('button', { type: 'button', class: 'linklike tech-name', onclick: () => editTransition(t.id) }, t.name),
      h('div', {}, h('span', { class: `type-badge t-${t.type}` }, TYPE[t.type]))),
    h('td', {}, refLink(t.from)),
    h('td', {}, refLink(t.to, t.type === 'submission')),
    h('td', {}, t.failsTo ? refLink(t.failsTo) : h('span', { class: 'muted' }, '—')),
    h('td', {}, t.backups.map(techById).filter(Boolean).map((b) => b.name).join(', ') || h('span', { class: 'muted' }, '—')),
    h('td', {}, h('span', { class: `status s-${t.status}` }, STATUS[t.status])))));
  $('#tech-empty').hidden = rows.length > 0;
}

// ----- graph view -----

function renderGraph() {
  if (!app.graph) {
    app.graph = new GraphView($('#graph-svg'), {
      onSelect: (id) => selectState(id),
      onMoved: () => { app.map.updated = Date.now(); store.saveMap(app.map); },
    });
  }
  const placed = app.graph.setMap(app.map, { showFails: app.showFails, selectedId: app.selected });
  if (placed) store.saveMap(app.map);
  $('#graph-empty').hidden = app.map.states.length > 0;
}

// ---------- editing: states ----------

async function editState(id) {
  const existing = id && stateById(id);
  const draft = existing ? structuredClone(existing) : { id: store.uid('s'), name: '', category: 'neutral', notes: '', micro: [] };

  const name = h('input', { required: true, maxlength: 120, value: draft.name, placeholder: 'e.g. Closed guard', autocomplete: 'off' });
  const cat = h('select', {}, options(store.CATEGORIES, draft.category));
  const notes = h('textarea', { rows: 3, placeholder: 'Key details, goals, what to look for…' });
  notes.value = draft.notes;

  const microList = h('ol', { class: 'micro-edit' });
  const microRow = (m) => {
    const n = h('input', { value: m.name, placeholder: 'e.g. Posture broken', maxlength: 120, 'aria-label': 'Microstate name' });
    const d = h('input', { value: m.notes, placeholder: 'Notes (optional)', 'aria-label': 'Microstate notes' });
    const row = h('li', { dataset: { id: m.id } }, n, d,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove microstate', onclick: () => row.remove() }, '✕'));
    return row;
  };
  draft.micro.forEach((m) => microList.append(microRow(m)));
  const addRow = () => {
    const row = microRow({ id: store.uid('u'), name: '', notes: '' });
    microList.append(row);
    row.querySelector('input').focus();
  };

  const result = await modal({
    title: existing ? 'Edit state' : 'New state',
    wide: true,
    body: [
      h('div', { class: 'row' }, field('Name', name), field('Perspective', cat)),
      field('Notes', notes),
      h('fieldset', {},
        h('legend', {}, 'Microstates'),
        h('p', { class: 'hint' }, 'Variations inside this state: grips, posture, frames, underhooks.'),
        microList,
        h('button', { type: 'button', class: 'small', onclick: addRow }, '+ Add microstate')),
    ],
    actions: [{ value: 'cancel', label: 'Cancel' }, { value: 'save', label: 'Save', primary: true }],
  });
  if (result !== 'save') return;

  const micro = [...microList.children]
    .map((li) => ({ id: li.dataset.id, name: li.children[0].value.trim(), notes: li.children[1].value.trim() }))
    .filter((m) => m.name);
  const next = { ...draft, name: name.value.trim() || 'Unnamed state', category: cat.value, notes: notes.value.trim(), micro };
  commit((map) => {
    const i = map.states.findIndex((s) => s.id === next.id);
    if (i >= 0) map.states[i] = next; else map.states.push(next);
    app.selected = next.id;
    return repair(map);
  });
}

async function addMicro(stateId) {
  const name = h('input', { required: true, maxlength: 120, placeholder: 'e.g. Opponent has underhook' });
  const notes = h('input', { placeholder: 'Optional' });
  const r = await modal({
    title: 'New microstate',
    body: [field('Name', name), field('Notes', notes)],
    actions: [{ value: 'cancel', label: 'Cancel' }, { value: 'save', label: 'Add', primary: true }],
  });
  if (r !== 'save' || !name.value.trim()) return;
  const m = { id: store.uid('u'), name: name.value.trim(), notes: notes.value.trim() };
  commit((map) => {
    map.states.find((s) => s.id === stateId)?.micro.push(m);
    app.micro = m.id;
  });
}

async function deleteState(id) {
  const st = stateById(id);
  if (!st) return;
  const outCount = app.map.transitions.filter((t) => t.from?.state === id).length;
  const ok = await confirmDialog('Delete state?',
    `“${st.name}”${outCount ? ` and the ${outCount} technique${outCount > 1 ? 's' : ''} that start from it` : ''} will be removed. Techniques leading here will lose their target.`,
    { danger: true, okLabel: 'Delete' });
  if (!ok) return;
  commit((map) => {
    map.states = map.states.filter((s) => s.id !== id);
    map.transitions = map.transitions.filter((t) => t.from?.state !== id);
    app.selected = null;
    return repair(map);
  }, { undo: `Deleted “${st.name}”` });
}

// ---------- editing: techniques ----------

function refPicker(ref, { allowNone = false, noneLabel = '—' } = {}) {
  const stateSel = h('select', { 'aria-label': 'State' },
    allowNone ? h('option', { value: '' }, noneLabel) : null,
    [...app.map.states].sort((a, b) => a.name.localeCompare(b.name)).map((s) => h('option', { value: s.id }, s.name)));
  const microSel = h('select', { 'aria-label': 'Microstate' });
  const fillMicro = (selected) => {
    const st = stateById(stateSel.value);
    microSel.replaceChildren(h('option', { value: '' }, st ? 'Any microstate' : '—'),
      ...(st ? st.micro.map((m) => h('option', { value: m.id }, m.name)) : []));
    microSel.value = selected && st?.micro.some((m) => m.id === selected) ? selected : '';
    microSel.disabled = !st || !st.micro.length;
  };
  stateSel.value = ref?.state || (allowNone ? '' : app.map.states[0]?.id || '');
  fillMicro(ref?.micro);
  stateSel.addEventListener('change', () => fillMicro(null));
  return {
    el: h('div', { class: 'ref-picker' }, stateSel, microSel),
    stateSel,
    get: () => (stateSel.value ? { state: stateSel.value, micro: microSel.value || null } : null),
  };
}

async function editTransition(id, preset = {}) {
  if (!app.map.states.length) {
    toast('Add a state first.');
    return;
  }
  const existing = id && techById(id);
  const t = existing ? structuredClone(existing) : {
    id: store.uid('t'), name: '', type: 'transition', status: 'learning',
    from: preset.from || { state: app.selected || app.map.states[0].id, micro: null },
    to: preset.to || null, failsTo: null, failNotes: '', backups: [], notes: '', link: '',
  };

  const name = h('input', { required: true, maxlength: 160, value: t.name, placeholder: 'e.g. Scissor sweep', autocomplete: 'off' });
  const type = h('select', {}, options(store.TYPES, t.type));
  const status = h('select', {}, options(store.STATUSES, t.status));
  const from = refPicker(t.from);
  const to = refPicker(t.to, { allowNone: true, noneLabel: '— none / finish —' });
  const failsTo = refPicker(t.failsTo, { allowNone: true, noneLabel: '— not mapped —' });
  const failNotes = h('textarea', { rows: 2, placeholder: 'Why it fails, what the opponent does…' });
  failNotes.value = t.failNotes;
  const notes = h('textarea', { rows: 3, placeholder: 'Key details, cues, grips…' });
  notes.value = t.notes;
  const link = h('input', { type: 'url', value: t.link, placeholder: 'https://… (video or instructional)' });

  // Backup picker: techniques starting where a failure lands are suggested first.
  const checked = new Set(t.backups);
  const backupFilter = h('input', { type: 'search', placeholder: 'Filter techniques', 'aria-label': 'Filter backups' });
  const backupList = h('div', { class: 'backup-list' });
  const drawBackups = () => {
    const anchor = failsTo.get()?.state || from.get()?.state;
    const q = backupFilter.value.trim().toLowerCase();
    const others = app.map.transitions.filter((x) => x.id !== t.id && (!q || x.name.toLowerCase().includes(q) || checked.has(x.id)));
    const suggested = others.filter((x) => x.from?.state === anchor);
    const rest = others.filter((x) => x.from?.state !== anchor);
    const item = (x) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: checked.has(x.id),
        onchange: (e) => (e.target.checked ? checked.add(x.id) : checked.delete(x.id)),
      }),
      h('span', {}, x.name, h('small', { class: 'muted' }, ` ${refText(x.from)} → ${refText(x.to, x.type === 'submission')}`)));
    fill(backupList,
      suggested.length ? h('p', { class: 'list-label' }, `Starting from ${stateById(anchor)?.name}`) : null,
      suggested.map(item),
      rest.length ? h('p', { class: 'list-label' }, 'Other techniques') : null,
      rest.map(item),
      !others.length ? h('p', { class: 'muted' }, 'No other techniques yet. Save this one, then use “+ backup” on its card.') : null);
  };
  failsTo.stateSel.addEventListener('change', drawBackups);
  from.stateSel.addEventListener('change', drawBackups);
  backupFilter.addEventListener('input', drawBackups);
  drawBackups();

  const actions = [{ value: 'cancel', label: 'Cancel' }, { value: 'save', label: 'Save', primary: true }];
  if (existing) actions.unshift({ value: 'delete', label: 'Delete', danger: true, left: true, novalidate: true });

  const result = await modal({
    title: existing ? 'Edit technique' : 'New technique',
    wide: true,
    body: [
      field('Technique', name),
      h('div', { class: 'row' }, field('Type', type), field('Status', status, 'Mark techniques that keep failing as “Failing”.')),
      h('div', { class: 'row' }, field('From', from.el), field('Leads to', to.el, 'Leave empty for a finishing submission.')),
      h('fieldset', { class: 'fail-fieldset' },
        h('legend', {}, 'If it fails'),
        field('You end up in', failsTo.el),
        field('What goes wrong', failNotes),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Backups'), backupFilter, backupList)),
      field('Notes', notes),
      field('Reference link', link),
    ],
    actions,
  });

  if (result === 'delete') {
    deleteTransition(t.id);
    return;
  }
  if (result !== 'save') return;

  const next = {
    ...t,
    name: name.value.trim() || 'Unnamed technique',
    type: type.value,
    status: status.value,
    from: from.get(),
    to: to.get(),
    failsTo: failsTo.get(),
    failNotes: failNotes.value.trim(),
    notes: notes.value.trim(),
    link: link.value.trim(),
    backups: [...checked],
  };
  commit((map) => {
    const i = map.transitions.findIndex((x) => x.id === next.id);
    if (i >= 0) map.transitions[i] = next; else map.transitions.push(next);
    if (preset.backupOf) map.transitions.find((x) => x.id === preset.backupOf)?.backups.push(next.id);
    return repair(map);
  });
}

function addBackup(parentId) {
  const p = techById(parentId);
  if (!p) return;
  editTransition(null, { from: p.failsTo || p.from, backupOf: parentId });
}

function deleteTransition(id) {
  const t = techById(id);
  if (!t) return;
  commit((map) => {
    map.transitions = map.transitions.filter((x) => x.id !== id);
    return repair(map);
  }, { undo: `Deleted “${t.name}”` });
}

// ---------- maps ----------

function openMap(id) {
  let map = store.loadMap(id);
  if (!map) {
    toast('That map could not be read and was skipped.');
    store.deleteMap(id);
    const next = store.listMaps()[0];
    if (next) return openMap(next.id);
    map = store.newMap('My game');
    store.saveMap(map, { immediate: true });
  }
  app.map = map;
  app.selected = null;
  app.micro = null;
  store.setPrefs({ map: map.id });
  render();
}

async function editMapInfo(map = app.map, title = 'Map details') {
  const name = h('input', { required: true, maxlength: 120, value: map.name });
  const notes = h('textarea', { rows: 4, placeholder: 'What this map is for: a game plan, a class series, competition prep…' });
  notes.value = map.notes;
  const r = await modal({
    title,
    body: [field('Name', name), field('Notes', notes)],
    actions: [{ value: 'cancel', label: 'Cancel' }, { value: 'save', label: 'Save', primary: true }],
  });
  if (r !== 'save') return false;
  map.name = name.value.trim() || 'Untitled map';
  map.notes = notes.value.trim();
  return true;
}

const mapActions = {
  async 'new-map'() {
    const m = store.newMap('New map');
    if (!(await editMapInfo(m, 'New map'))) return;
    store.saveMap(m, { immediate: true });
    openMap(m.id);
  },
  async 'rename-map'() {
    if (await editMapInfo()) commit(() => {});
  },
  'duplicate-map'() {
    const m = store.normalizeMap(structuredClone(app.map), { freshId: true });
    m.name = `${app.map.name} (copy)`;
    m.created = m.updated = Date.now();
    store.saveMap(m, { immediate: true });
    openMap(m.id);
    toast('Map duplicated.');
  },
  async 'delete-map'() {
    const ok = await confirmDialog('Delete map?', `“${app.map.name}” will be permanently removed from this device. Export it first if you might want it back.`, { danger: true, okLabel: 'Delete map' });
    if (!ok) return;
    store.deleteMap(app.map.id);
    const next = store.listMaps()[0];
    if (next) openMap(next.id);
    else {
      const m = store.newMap('My game');
      store.saveMap(m, { immediate: true });
      openMap(m.id);
    }
  },
  'import-file'() { $('#import-input').click(); },
  'export-file'() { share.download(share.mapFile(app.map)); },
  'load-example'() {
    const m = sampleMap();
    store.saveMap(m, { immediate: true });
    openMap(m.id);
  },
};

// ---------- import / share ----------

async function importMaps(rawMaps, source, { allowRestore = false } = {}) {
  // Keep original IDs so a restore can match maps already on this device.
  const seen = new Set();
  const maps = rawMaps.map((r) => {
    const m = store.normalizeMap(r);
    if (seen.has(m.id)) m.id = store.uid('m');
    seen.add(m.id);
    return m;
  });
  const existing = new Map(store.listMaps().map((e) => [e.id, e]));
  const matching = allowRestore ? maps.filter((m) => existing.has(m.id)) : [];

  const summary = maps.map((m) => h('li', {}, h('strong', {}, m.name),
    ` — ${m.states.length} states, ${m.transitions.length} techniques`,
    matching.includes(m) ? h('span', { class: 'muted' }, ' (on this device)') : null));
  const actions = [{ value: 'cancel', label: 'Cancel' }];
  if (matching.length) actions.push({ value: 'restore', label: 'Restore' });
  actions.push({ value: 'copy', label: matching.length ? 'Add as copies' : 'Import', primary: true });

  const choice = await modal({
    title: maps.length > 1 ? `Import ${maps.length} maps?` : 'Import map?',
    body: [
      h('p', {}, `From ${source}:`),
      h('ul', { class: 'import-list' }, summary),
      matching.length
        ? h('p', { class: 'muted' },
          `Restore replaces the ${matching.length === 1 ? 'map' : `${matching.length} maps`} already on this device with the backup version and adds the rest. `,
          'Add as copies keeps everything you have and adds the backup alongside it.')
        : h('p', { class: 'muted' }, 'Imported maps are added as new maps. Your existing maps are not changed.'),
    ],
    actions,
  });
  if (choice !== 'restore' && choice !== 'copy') return;

  const restoring = choice === 'restore';
  const replaced = [];
  const added = [];
  if (restoring) store.flush(); // so the snapshots below include the latest edits
  const names = new Set([...existing.values()].map((e) => e.name));
  for (const m of maps) {
    if (restoring && existing.has(m.id)) {
      const prev = store.loadMap(m.id);
      if (prev) replaced.push(prev);
    } else {
      if (!restoring || existing.has(m.id)) m.id = store.uid('m');
      if (!restoring && names.has(m.name)) m.name += ' (imported)';
      if (!restoring) m.updated = Date.now();
      added.push(m.id);
    }
    store.saveMap(m);
  }
  if (!store.flush()) return;
  requestPersistence();

  const current = maps.find((m) => m.id === app.map?.id) || maps[0];
  openMap(current.id);
  const count = maps.length > 1 ? `${maps.length} maps` : `“${maps[0].name}”`;
  if (!restoring) {
    toast(`Imported ${count}.`);
    return;
  }
  toast(`Restored ${count}.`, {
    action: 'Undo',
    duration: 10000,
    onAction: () => {
      for (const prev of replaced) store.saveMap(prev);
      for (const id of added) store.deleteMap(id);
      store.flush();
      openMap(store.listMaps().some((e) => e.id === app.map.id) ? app.map.id : store.listMaps()[0]?.id);
      toast('Restore undone.');
    },
  });
}

async function importFile(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('File is too large to be a map export.');
    const data = JSON.parse(await file.text());
    await importMaps(store.unwrapImport(data), `“${file.name}”`, { allowRestore: true });
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

async function handleShareHash() {
  const payload = share.readShareHash();
  if (!payload) return;
  share.clearShareHash();
  try {
    const raw = await share.decodeMap(payload);
    await importMaps([raw], 'a shared link');
  } catch (err) {
    toast(`Could not open shared map: ${err.message}`);
  }
}

async function openShare() {
  store.flush();
  const url = await share.shareUrl(app.map);
  const file = share.mapFile(app.map);
  const canShareFile = !!navigator.canShare?.({ files: [file] });
  const urlInput = h('input', { readonly: true, value: url, 'aria-label': 'Share link', onfocus: (e) => e.target.select() });

  await modal({
    title: 'Share map',
    body: [
      h('p', {}, 'The whole map is packed into the link itself. Nothing is uploaded; whoever opens it can import their own copy.'),
      h('div', { class: 'copy-row' }, urlInput,
        h('button', {
          type: 'button', class: 'primary',
          onclick: async () => {
            try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { urlInput.select(); toast('Press Ctrl+C to copy.'); }
          },
        }, 'Copy link')),
      url.length > 6000 ? h('p', { class: 'warn' }, `This link is long (${Math.round(url.length / 1000)}k characters). Some chat apps cut long links short; sharing the file is more reliable.`) : null,
      h('div', { class: 'button-row' },
        navigator.share ? h('button', {
          type: 'button',
          onclick: () => navigator.share({ title: app.map.name, text: `Jiu-Jitsu Map: ${app.map.name}`, url }).catch(() => {}),
        }, 'Share link…') : null,
        canShareFile ? h('button', {
          type: 'button',
          onclick: () => navigator.share({ title: app.map.name, files: [file] }).catch(() => {}),
        }, 'Share file…') : null,
        h('button', { type: 'button', onclick: () => share.download(file) }, 'Download file')),
      h('p', { class: 'hint' }, 'Files can be opened with Import in the ⋯ menu.'),
    ],
    actions: [{ value: 'ok', label: 'Done' }],
  });
}

// ---------- print ----------

async function openPrint() {
  const o = app.printOpts;
  const box = (key, text) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; } }), h('span', {}, text));
  const r = await modal({
    title: 'Print map',
    body: [
      h('p', {}, 'A clean printout for your notebook or the gym wall. Choose “Save as PDF” in the print dialog for a shareable PDF.'),
      box('graph', 'Flow graph'),
      box('notes', 'Notes and details'),
      box('status', 'Technique status'),
      box('failing', '“When it goes wrong” summary of failures and backups'),
    ],
    actions: [{ value: 'cancel', label: 'Cancel' }, { value: 'print', label: 'Print', primary: true }],
  });
  if (r !== 'print') return;
  store.setPrefs({ printOpts: o });
  renderPrint(app.map, o);
  window.print();
}

// ---------- settings / data ----------

async function deleteOwnCaches() {
  if (!('caches' in self)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
}

async function openSettings() {
  store.flush();
  const { bytes, keys } = store.usage();
  const persistLine = h('span', {}, 'Checking…');
  const estimateLine = h('span', { class: 'muted' });
  const persistBtn = h('button', { type: 'button', class: 'small', hidden: true }, 'Request persistent storage');

  const updatePersist = async () => {
    if (!navigator.storage?.persisted) {
      persistLine.textContent = 'Not supported by this browser.';
      return;
    }
    const granted = await navigator.storage.persisted();
    persistLine.textContent = granted
      ? 'Granted — the browser will not clear your maps to free up space.'
      : 'Not granted — the browser may clear data under storage pressure. Installing the app usually helps.';
    persistBtn.hidden = granted;
  };
  persistBtn.addEventListener('click', async () => {
    const ok = await requestPersistence(true);
    await updatePersist();
    if (!ok) toast('The browser declined. Try installing the app, then ask again.');
  });
  updatePersist();
  navigator.storage?.estimate?.().then((e) => {
    if (e?.quota) estimateLine.textContent = ` (browser quota for this site: ${formatBytes(e.quota)})`;
  }).catch(() => {});

  const r = await modal({
    title: 'Data & storage',
    body: [
      h('section', { class: 'settings-block' },
        h('h3', {}, 'Stored on this device'),
        h('p', {}, `${store.listMaps().length} maps, ${formatBytes(bytes)} in ${keys} keys`, estimateLine),
        h('p', { class: 'hint' }, `Only keys starting with “${store.PREFIX}” and caches starting with “${CACHE_PREFIX}” are ever touched.`)),
      h('section', { class: 'settings-block' },
        h('h3', {}, 'Persistent storage'),
        h('p', {}, persistLine), persistBtn),
      h('section', { class: 'settings-block' },
        h('h3', {}, 'Backup'),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', onclick: exportAll }, 'Export all maps'),
          h('button', { type: 'button', onclick: () => $('#import-input').click() }, 'Import file…'))),
      h('section', { class: 'settings-block' },
        h('h3', {}, 'Reset'),
        h('p', { class: 'hint' }, 'Removes every map and cached app file from this device. Other sites and apps are not affected.'),
        h('button', { type: 'button', class: 'danger', value: 'wipe', formnovalidate: true }, 'Delete all Jiu-Jitsu Map data')),
      h('p', { class: 'hint about' }, `Jiu-Jitsu Map ${APP_VERSION} · works offline · your data never leaves this device unless you share it.`),
    ],
    actions: [{ value: 'ok', label: 'Close' }],
  });
  if (r === 'wipe') {
    const ok = await confirmDialog('Delete everything?', 'All maps on this device will be erased. This cannot be undone.', { danger: true, okLabel: 'Erase all' });
    if (!ok) return;
    store.clearAll();
    await deleteOwnCaches();
    location.reload();
  }
}

function exportAll() {
  store.flush();
  const maps = store.listMaps().map((e) => store.loadMap(e.id)).filter(Boolean);
  const data = { format: store.FORMAT + '-backup', version: store.FORMAT_VERSION, exported: new Date().toISOString(), maps };
  const date = new Date().toISOString().slice(0, 10);
  share.download(new File([JSON.stringify(data, null, 2)], `jjmap-backup-${date}.json`, { type: 'application/json' }));
}

// ---------- service worker & install ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Reload only when the user accepted an update, never on the first install's claim().
  let updateAccepted = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted || reloading) return;
    reloading = true;
    store.flush();
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    const offer = (worker) => toast('A new version is ready.', {
      action: 'Update', duration: 0,
      onAction: () => { updateAccepted = true; worker.postMessage({ type: 'jjmap:skip-waiting' }); },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
}

function setupInstall() {
  const btn = $('#install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    app.installPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    const p = app.installPrompt;
    if (!p) return;
    app.installPrompt = null;
    btn.hidden = true;
    p.prompt();
    await p.userChoice.catch(() => {});
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    requestPersistence(true);
  });
}

// ---------- wiring ----------

function bind() {
  $('#map-select').addEventListener('change', (e) => { store.flush(); openMap(e.target.value); });

  const menuBtn = $('#map-menu-btn');
  const menu = $('#map-menu');
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button')?.focus();
  });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    closeMenu();
    mapActions[action]?.();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMenu(); menuBtn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });

  const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      setView(next.dataset.view);
    });
  });

  $('#share-btn').addEventListener('click', openShare);
  $('#print-btn').addEventListener('click', openPrint);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#add-state-btn').addEventListener('click', () => editState());
  $('#state-filter').addEventListener('input', (e) => { app.stateFilter = e.target.value; renderStates(); });

  $('#add-tech-btn').addEventListener('click', () => editTransition(null));
  $('#tech-search').addEventListener('input', (e) => { app.tech.q = e.target.value; renderTechniques(); });
  for (const [sel, key] of [['#tech-type', 'type'], ['#tech-status', 'status'], ['#tech-state', 'state']]) {
    $(sel).addEventListener('change', (e) => { app.tech[key] = e.target.value; renderTechniques(); });
  }
  $('#tech-type').append(...options(store.TYPES));
  $('#tech-status').append(...options(store.STATUSES));

  $('#graph-fit').addEventListener('click', () => app.graph?.fit());
  $('#graph-zoom-in').addEventListener('click', () => app.graph?.zoom(0.8));
  $('#graph-zoom-out').addEventListener('click', () => app.graph?.zoom(1.25));
  $('#graph-relayout').addEventListener('click', () => {
    if (!app.graph) return;
    const before = JSON.stringify(app.map);
    app.graph.relayout();
    store.saveMap(app.map);
    toast('Re-arranged.', {
      action: 'Undo',
      onAction: () => { app.map = JSON.parse(before); store.saveMap(app.map); renderGraph(); app.graph.fit(); },
    });
  });
  $('#graph-fails').checked = app.showFails;
  $('#graph-fails').addEventListener('change', (e) => { app.showFails = e.target.checked; store.setPrefs({ showFails: app.showFails }); renderGraph(); });

  $('#import-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importFile(f);
  });

  // Ctrl+P / browser menu printing still gets a proper printout.
  window.addEventListener('beforeprint', () => renderPrint(app.map, app.printOpts));

  // Never lose the last edit.
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });

  // Stay in sync with other open tabs of this app (our keys only).
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || !e.key?.startsWith(store.PREFIX)) return;
    if (e.key === `${store.PREFIX}map:${app.map.id}`) {
      const fresh = store.loadMap(app.map.id);
      if (fresh) { app.map = fresh; render(); }
      else openMap(store.listMaps()[0]?.id);
    } else if (e.key === `${store.PREFIX}index`) {
      renderMapPicker();
    }
  });

  window.addEventListener('hashchange', handleShareHash);
}

function init() {
  store.onStorageError((err) => {
    const full = err?.name === 'QuotaExceededError' || err?.code === 22;
    toast(full
      ? 'Storage is full — changes are not being saved. Export your maps, then delete ones you no longer need.'
      : 'Could not save to this device (storage may be disabled). Export your map to keep it.', { duration: 0 });
  });

  if (!store.listMaps().length) store.saveMap(sampleMap(), { immediate: true });

  const prefs = store.getPrefs();
  if (prefs.printOpts) Object.assign(app.printOpts, prefs.printOpts);
  if (typeof prefs.showFails === 'boolean') app.showFails = prefs.showFails;

  bind();
  setupInstall();

  const idx = store.listMaps();
  openMap(idx.some((e) => e.id === prefs.map) ? prefs.map : idx[0]?.id);
  if (prefs.selected && stateById(prefs.selected)) app.selected = prefs.selected;
  setView(['states', 'techniques', 'graph'].includes(prefs.view) ? prefs.view : 'states');

  handleShareHash();
  registerServiceWorker();
  requestPersistence();
}

init();
