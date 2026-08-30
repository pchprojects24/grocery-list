// =============================================================================
// UI toolkit: safe DOM building, toasts, dialogs, action sheets
// =============================================================================
// Two rules this module exists to enforce:
//
//  1. No user-supplied value is ever written through innerHTML. Every helper
//     here sets textContent, so an item literally named
//     `<img src=x onerror=alert(1)>` renders as those characters and nothing
//     else. The old Firebase build interpolated item, list, store and section
//     names straight into template literals passed to innerHTML.
//
//  2. No browser prompt()/confirm()/alert(). Those block the page, look wrong
//     inside a home-screen PWA, and cannot be styled for one-handed use.
//     Everything goes through the <dialog>-based helpers below.
// =============================================================================

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props] className, text, attrs, dataset, on:{event:handler}, …
 * @param {(Node|string|null|false|undefined)[]} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') {
      node.textContent = String(value);           // always escaped
    } else if (key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'attrs') {
      for (const [name, v] of Object.entries(value)) {
        if (v !== null && v !== undefined && v !== false) node.setAttribute(name, String(v));
      }
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Remove every child of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children in one go. */
export function render(node, ...children) {
  clear(node);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (id) => document.getElementById(id);

export function show(node, visible = true) {
  if (node) node.classList.toggle('hidden', !visible);
}

// -----------------------------------------------------------------------------
// Toasts
// -----------------------------------------------------------------------------
let toastTimer = null;

/**
 * Transient message at the bottom of the screen.
 * @param {string} message
 * @param {{tone?: 'info'|'error'|'success', actionLabel?: string,
 *          onAction?: () => void, duration?: number}} [options]
 */
export function toast(message, options = {}) {
  const host = $('toast-host');
  if (!host) return;
  const { tone = 'info', actionLabel, onAction, duration = tone === 'error' ? 6000 : 3500 } = options;

  clearTimeout(toastTimer);
  const node = el('div', { className: `toast toast-${tone}`, attrs: { role: 'status', 'aria-live': 'polite' } }, [
    el('span', { className: 'toast-text', text: message }),
    actionLabel && el('button', {
      className: 'toast-action', type: 'button', text: actionLabel,
      on: { click: () => { clear(host); if (onAction) onAction(); } }
    })
  ]);
  render(host, node);
  toastTimer = setTimeout(() => { if (host.firstChild === node) clear(host); }, duration);
}

export const toastError = (message) => toast(message, { tone: 'error' });

// -----------------------------------------------------------------------------
// Dialogs
//
// One <dialog> element is reused for every modal. `showModal()` gives us focus
// trapping, Escape-to-close and the backdrop for free.
// -----------------------------------------------------------------------------
function dialogShell(title, bodyNodes, footerNodes) {
  const dialog = $('app-dialog');
  render(dialog,
    el('form', { method: 'dialog', className: 'dialog-form' }, [
      el('h2', { className: 'dialog-title', text: title }),
      el('div', { className: 'dialog-body' }, bodyNodes),
      el('div', { className: 'dialog-footer' }, footerNodes)
    ])
  );
  return dialog;
}

function openDialog(dialog, onClose) {
  const handle = () => {
    dialog.removeEventListener('close', handle);
    onClose(dialog.returnValue);
  };
  dialog.addEventListener('close', handle);
  dialog.showModal();
}

/**
 * Yes/no question. Resolves true when confirmed.
 * @param {{title: string, message?: string, confirmLabel?: string,
 *          cancelLabel?: string, danger?: boolean}} options
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm',
                                cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = dialogShell(title,
      message ? [el('p', { className: 'dialog-message', text: message })] : [],
      [
        el('button', { className: 'btn btn-outline', value: 'cancel', text: cancelLabel, type: 'submit' }),
        el('button', {
          className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
          value: 'confirm', text: confirmLabel, type: 'submit'
        })
      ]);
    openDialog(dialog, (value) => resolve(value === 'confirm'));
  });
}

/**
 * A small form. Resolves to an object of field values, or null if cancelled.
 *
 * @param {{title: string, submitLabel?: string, fields: Array<{
 *   name: string, label: string, value?: string, placeholder?: string,
 *   type?: 'text'|'textarea'|'select'|'email'|'password',
 *   options?: Array<{value: string, label: string}>,
 *   required?: boolean, maxLength?: number, autocapitalize?: string
 * }>}} options
 */
export function formDialog({ title, fields, submitLabel = 'Save' }) {
  return new Promise((resolve) => {
    const inputs = new Map();

    const body = fields.map((field) => {
      const id = `dlg-${field.name}`;
      let input;
      if (field.type === 'textarea') {
        input = el('textarea', {
          id, rows: 3, value: field.value ?? '',
          placeholder: field.placeholder ?? '', maxLength: field.maxLength ?? 500
        });
      } else if (field.type === 'select') {
        input = el('select', { id }, (field.options || []).map((opt) =>
          el('option', { value: opt.value, text: opt.label, selected: opt.value === (field.value ?? '') })
        ));
      } else {
        input = el('input', {
          id, type: field.type || 'text', value: field.value ?? '',
          placeholder: field.placeholder ?? '', maxLength: field.maxLength ?? 120,
          autocomplete: field.autocomplete || 'off',
          attrs: { autocapitalize: field.autocapitalize || 'sentences' }
        });
      }
      inputs.set(field.name, { input, required: field.required });
      return el('label', { className: 'dialog-field' }, [
        el('span', { className: 'dialog-label', text: field.label }),
        input
      ]);
    });

    const submit = el('button', {
      className: 'btn btn-primary', value: 'ok', text: submitLabel, type: 'submit'
    });

    const dialog = dialogShell(title, body, [
      el('button', { className: 'btn btn-outline', value: 'cancel', text: 'Cancel', type: 'submit' }),
      submit
    ]);

    // A <form method="dialog"> submits regardless of validity, so required
    // fields are checked by hand.
    submit.addEventListener('click', (event) => {
      for (const [, { input, required }] of inputs) {
        if (required && !input.value.trim()) {
          event.preventDefault();
          input.focus();
          input.classList.add('field-invalid');
          return;
        }
      }
    });

    openDialog(dialog, (value) => {
      if (value !== 'ok') return resolve(null);
      const result = {};
      for (const [name, { input }] of inputs) result[name] = input.value.trim();
      resolve(result);
    });

    const first = fields[0] && inputs.get(fields[0].name);
    if (first) { first.input.focus(); first.input.select?.(); }
  });
}

/** Convenience wrapper for the single-text-field case (rename, etc). */
export async function promptDialog({ title, label, value = '', placeholder = '',
                                     submitLabel = 'Save', maxLength = 80 }) {
  const result = await formDialog({
    title, submitLabel,
    fields: [{ name: 'value', label, value, placeholder, required: true, maxLength }]
  });
  return result ? result.value : null;
}

/**
 * Bottom action sheet — the replacement for `prompt("type archive or delete")`.
 *
 * @param {{title: string, subtitle?: string, actions: Array<{
 *   label: string, value: string, danger?: boolean, description?: string
 * }>}} options
 * @returns {Promise<string|null>} the chosen action's value
 */
export function actionSheet({ title, subtitle, actions }) {
  return new Promise((resolve) => {
    const dialog = $('app-dialog');
    dialog.classList.add('dialog-sheet');

    render(dialog, el('form', { method: 'dialog', className: 'sheet-form' }, [
      el('div', { className: 'sheet-header' }, [
        el('h2', { className: 'sheet-title', text: title }),
        subtitle && el('p', { className: 'sheet-subtitle', text: subtitle })
      ]),
      el('div', { className: 'sheet-actions' }, actions.map((action) =>
        el('button', {
          type: 'submit', value: action.value,
          className: `sheet-btn${action.danger ? ' sheet-btn-danger' : ''}`
        }, [
          el('span', { className: 'sheet-btn-label', text: action.label }),
          action.description && el('span', { className: 'sheet-btn-desc', text: action.description })
        ])
      )),
      el('button', { type: 'submit', value: 'cancel', className: 'sheet-btn sheet-cancel', text: 'Cancel' })
    ]));

    openDialog(dialog, (value) => {
      dialog.classList.remove('dialog-sheet');
      resolve(value && value !== 'cancel' ? value : null);
    });
  });
}

// -----------------------------------------------------------------------------
// Small formatting helpers
// -----------------------------------------------------------------------------
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year:
    date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function pluralise(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// -----------------------------------------------------------------------------
// Navigation
//
// Top-level views are mutually exclusive; inside the main view there are four
// tabs plus a stack of full-screen overlays (a list, a store, a past trip).
// Keeping the stack here means the back button has exactly one implementation.
// -----------------------------------------------------------------------------
const VIEWS = {
  loading: 'view-loading',
  setup: 'view-setup',
  auth: 'view-auth',
  onboarding: 'view-onboarding',
  main: 'view-main'
};

const TAB_TITLES = {
  home: 'Young Lists',
  history: 'History',
  stores: 'My stores',
  settings: 'Settings'
};

let currentTab = 'home';
const overlayStack = [];

export function showView(name) {
  for (const [key, id] of Object.entries(VIEWS)) show($(id), key === name);
}

export function currentTabName() {
  return currentTab;
}

export function switchTab(tab) {
  closeAllOverlays();
  currentTab = tab;
  for (const button of document.querySelectorAll('.nav-btn')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  for (const name of Object.keys(TAB_TITLES)) show($(`tab-${name}`), name === tab);
  setHeader(TAB_TITLES[tab], { back: false, menu: null });
  $(`tab-${tab}`)?.scrollTo(0, 0);
}

/**
 * @param {string} title
 * @param {{back?: boolean, menu?: (() => void)|null}} options
 */
export function setHeader(title, { back = false, menu = null } = {}) {
  $('header-title').textContent = title;
  show($('btn-back'), back);
  show($('btn-menu'), Boolean(menu));
  $('btn-menu').onclick = menu || null;   // assignment, never addEventListener,
                                          // so re-rendering cannot stack handlers
}

/**
 * Push a full-screen overlay (list detail, store detail, trip detail).
 * @param {string} id element id of the overlay section
 * @param {{title: string, menu?: (() => void)|null, onClose?: () => void}} options
 */
export function openOverlay(id, { title, menu = null, onClose = null }) {
  for (const name of Object.keys(TAB_TITLES)) show($(`tab-${name}`), false);
  for (const entry of overlayStack) show($(entry.id), false);
  overlayStack.push({ id, title, menu, onClose });
  show($(id), true);
  setHeader(title, { back: true, menu });
}

export function updateOverlayHeader(title, menu) {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return;
  top.title = title;
  if (menu !== undefined) top.menu = menu;
  setHeader(top.title, { back: true, menu: top.menu });
}

export function closeOverlay() {
  const closed = overlayStack.pop();
  if (closed) {
    show($(closed.id), false);
    if (closed.onClose) closed.onClose();
  }
  const next = overlayStack[overlayStack.length - 1];
  if (next) {
    show($(next.id), true);
    setHeader(next.title, { back: true, menu: next.menu });
  } else {
    switchTab(currentTab);
  }
  return Boolean(closed);
}

export function closeAllOverlays() {
  while (overlayStack.length) {
    const closed = overlayStack.pop();
    show($(closed.id), false);
    if (closed.onClose) closed.onClose();
  }
}

export function isOverlayOpen(id) {
  return overlayStack.some((entry) => entry.id === id);
}
