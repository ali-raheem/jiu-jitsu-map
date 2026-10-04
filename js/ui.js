// Small DOM helpers: hyperscript, modal dialogs, toasts.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) node.value = value; // after <option>s exist
  return node;
}

// Like replaceChildren, but flattens nested arrays and skips null/false.
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

export function options(pairs, selected) {
  return pairs.map(([v, label]) => h('option', { value: v, selected: v === selected }, label));
}

let fieldSeq = 0;
export function field(label, control, hint) {
  const labelable = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);
  const id = control.id || (control.id = `f${++fieldSeq}`);
  if (labelable) {
    return h('div', { class: 'field' },
      h('label', { for: id }, label),
      control,
      hint ? h('small', { class: 'hint' }, hint) : null);
  }
  // Composite controls (e.g. state + microstate pickers) are labelled as a group.
  control.setAttribute('role', 'group');
  control.setAttribute('aria-labelledby', `${id}-label`);
  return h('div', { class: 'field' },
    h('span', { class: 'label', id: `${id}-label` }, label),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null);
}

// Resolves with the clicked action's value, or '' when dismissed.
// `onSubmit(value, form)` may return false to keep the dialog open.
export function modal({ title, body, actions = [{ value: 'ok', label: 'OK', primary: true }], wide = false, onSubmit }) {
  return new Promise((resolve) => {
    const titleId = `modal-title-${++fieldSeq}`;
    const form = h('form', { method: 'dialog', class: 'modal-form' });
    const dlg = h('dialog', { class: `modal${wide ? ' wide' : ''}`, 'aria-labelledby': titleId }, form);
    form.append(
      h('header', { class: 'modal-head' },
        h('h2', { id: titleId }, title),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close('') }, '✕')),
      h('div', { class: 'modal-body' }, body),
      h('footer', { class: 'modal-foot' },
        actions.map((a) => h('button', {
          value: a.value,
          class: [a.primary && 'primary', a.danger && 'danger', a.left && 'left'].filter(Boolean).join(' '),
          formnovalidate: a.novalidate || a.value === 'cancel',
        }, a.label))));
    form.addEventListener('submit', (e) => {
      const value = e.submitter?.value ?? 'ok';
      if (value !== 'cancel' && onSubmit && onSubmit(value, form) === false) e.preventDefault();
    });
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue === 'cancel' ? '' : dlg.returnValue;
      dlg.remove();
      resolve(v);
    });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('.modal-body input:not([type=checkbox]), .modal-body textarea, .modal-body select');
    if (first) first.focus();
  });
}

export async function confirmDialog(title, message, { danger = false, okLabel = 'OK' } = {}) {
  const v = await modal({
    title,
    body: h('p', {}, message),
    actions: [{ value: 'cancel', label: 'Cancel' }, { value: 'ok', label: okLabel, primary: !danger, danger }],
  });
  return v === 'ok';
}

let toastTimer = 0;
export function toast(message, { action, onAction, duration = 4000 } = {}) {
  const box = document.getElementById('toast');
  box.replaceChildren(h('span', {}, message));
  if (action) {
    box.append(h('button', { type: 'button', onclick: () => { box.classList.remove('show'); onAction(); } }, action));
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => box.classList.remove('show'), duration);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
