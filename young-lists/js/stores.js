// =============================================================================
// Stores and their walking order
// =============================================================================
// This is the feature the household actually cares about: a store is a list of
// departments in the order you physically walk them, and any shopping list
// assigned to that store sorts itself to match.
//
// Sections are database rows with stable ids, so renaming "Produce" to
// "Fruit & Veg" keeps every item that was assigned to it. Removing a section
// leaves its items on the list as Unsorted rather than deleting groceries.
// =============================================================================

import { friendlyError } from './supabase.js';
import * as data from './data.js';
import {
  $, el, render, toast, toastError, confirmDialog, promptDialog, formDialog,
  actionSheet, openOverlay, closeOverlay, updateOverlayHeader, pluralise
} from './ui.js';

// Convenient starting points, not a fixed menu: every one of these is editable
// afterwards and any other store can be typed in by hand.
const STARTER_LAYOUTS = [
  {
    name: 'Atlantic Superstore',
    sections: ['Produce', 'Bakery', 'Deli', 'Meat', 'Seafood', 'Pantry', 'Dairy',
               'Frozen', 'Household', 'Pharmacy', 'Checkout']
  },
  {
    name: 'Sobeys',
    sections: ['Bakery', 'Produce', 'Deli', 'Meat', 'Seafood', 'Dairy', 'Pantry',
               'Frozen', 'Household', 'Checkout']
  },
  {
    name: 'Costco',
    sections: ['Bulk & Snacks', 'Household', 'Pantry', 'Produce', 'Meat', 'Dairy',
               'Frozen', 'Checkout']
  },
  {
    name: 'Pharmacy',
    sections: ['Prescriptions', 'Health', 'Personal care', 'Household', 'Checkout']
  }
];

let activeStoreId = null;

// -----------------------------------------------------------------------------
// Stores tab
// -----------------------------------------------------------------------------
export function renderStores() {
  const container = $('stores-container');

  if (!data.state.stores.length) {
    render(container, el('p', {
      className: 'empty-state',
      text: 'No stores yet. Add one below, or start from one of the layouts.'
    }));
  } else {
    render(container, data.state.stores.map((store) => {
      const names = store.sections.map((s) => s.name);
      const preview = names.slice(0, 4).join(' › ') + (names.length > 4 ? ' › …' : '');
      return el('div', {
        className: 'list-card', attrs: { role: 'button', tabindex: '0' },
        on: {
          click: () => openStoreDetail(store.id),
          keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStoreDetail(store.id); } }
        }
      }, [
        el('div', { className: 'list-info' }, [
          el('span', { className: 'list-name', text: storeLabel(store) }),
          el('span', {
            className: 'list-meta',
            text: names.length ? `${pluralise(names.length, 'section')}: ${preview}`
                               : 'No sections yet — tap to add your route'
          })
        ]),
        el('button', {
          className: 'list-actions-btn', type: 'button', text: '⋯',
          attrs: { 'aria-label': `Actions for ${store.name}` },
          on: { click: (event) => { event.stopPropagation(); storeActions(store); } }
        })
      ]);
    }));
  }

  renderStarterLayouts();
}

function storeLabel(store) {
  return store.location ? `${store.name} (${store.location})` : store.name;
}

function renderStarterLayouts() {
  const existing = new Set(data.state.stores.map((s) => s.name.toLowerCase()));
  render($('store-templates'), STARTER_LAYOUTS.map((layout) => el('button', {
    className: 'chip', type: 'button',
    text: existing.has(layout.name.toLowerCase()) ? `${layout.name} ✓` : layout.name,
    disabled: existing.has(layout.name.toLowerCase()),
    on: { click: () => createStore(layout.name, null, layout.sections) }
  })));
}

async function createStoreFromInput() {
  const input = $('new-store-name');
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  await createStore(name, null, []);
}

async function createStore(name, location, sections) {
  const { data: storeId, error } = await data.createStore(name, location, sections);
  if (error) return toastError(friendlyError(error, 'Could not add that store.'));
  await data.loadStores();
  renderStores();
  if (storeId) openStoreDetail(storeId);
}

async function storeActions(store) {
  const choice = await actionSheet({
    title: storeLabel(store),
    actions: [
      { label: 'Edit route', value: 'open' },
      { label: 'Rename or set location', value: 'rename' },
      { label: 'Delete store', value: 'delete', danger: true,
        description: 'Lists using it keep their items, just without a route' }
    ]
  });
  if (!choice) return;

  if (choice === 'open') return openStoreDetail(store.id);

  if (choice === 'rename') {
    const result = await formDialog({
      title: 'Edit store',
      fields: [
        { name: 'name', label: 'Store name', value: store.name, required: true, maxLength: 80 },
        { name: 'location', label: 'Location (optional)', value: store.location || '',
          placeholder: 'e.g. Bayers Lake', maxLength: 120 }
      ]
    });
    if (!result) return;
    const { error } = await data.updateStore(store.id, {
      name: result.name, location: result.location || null
    });
    if (error) return toastError(friendlyError(error, 'Could not rename the store.'));
    await data.loadStores();
    renderStores();
    if (activeStoreId === store.id) renderStoreDetail();
    return;
  }

  if (choice === 'delete') {
    const usedBy = data.state.lists.filter((l) => l.store_id === store.id).length;
    const ok = await confirmDialog({
      title: `Delete "${store.name}"?`,
      message: usedBy
        ? `Its ${pluralise(store.sections.length, 'section')} will go, and ${pluralise(usedBy, 'list')} will fall back to no route. No groceries are deleted.`
        : `Its ${pluralise(store.sections.length, 'section')} will go. No groceries are deleted.`,
      confirmLabel: 'Delete', danger: true
    });
    if (!ok) return;
    const { error } = await data.deleteStore(store.id);
    if (error) return toastError(friendlyError(error, 'Could not delete the store.'));
    await Promise.all([data.loadStores(), data.loadLists()]);
    renderStores();
    toast('Store deleted.');
  }
}

// -----------------------------------------------------------------------------
// Store detail — the walking order editor
// -----------------------------------------------------------------------------
export function openStoreDetail(storeId) {
  activeStoreId = storeId;
  const store = currentStore();
  if (!store) return;

  openOverlay('view-store-detail', {
    title: storeLabel(store),
    menu: () => storeActions(currentStore()),
    onClose: () => { activeStoreId = null; }
  });
  renderStoreDetail();
  $('new-section-input').value = '';
}

function currentStore() {
  return data.state.stores.find((s) => s.id === activeStoreId) || null;
}

export function renderStoreDetail() {
  const store = currentStore();
  if (!store) {
    // Deleted on the other device while we were looking at it.
    if (activeStoreId) closeOverlay();
    return;
  }

  updateOverlayHeader(storeLabel(store), () => storeActions(currentStore()));

  const sections = store.sections;
  const container = $('store-sections-container');

  if (!sections.length) {
    return render(container, el('p', {
      className: 'empty-state',
      text: 'Add the departments in the order you walk them — Produce first if that is where you start.'
    }));
  }

  render(container, sections.map((section, index) => el('div', { className: 'section-row' }, [
    el('span', { className: 'section-order', text: String(index + 1) }),
    el('button', {
      className: 'section-name', type: 'button', text: section.name,
      attrs: { 'aria-label': `Rename ${section.name}` },
      on: { click: () => renameSection(section) }
    }),
    el('div', { className: 'section-actions' }, [
      el('button', {
        className: 'icon-btn-sm', type: 'button', text: '▲', disabled: index === 0,
        attrs: { 'aria-label': `Move ${section.name} earlier` },
        on: { click: () => move(index, -1) }
      }),
      el('button', {
        className: 'icon-btn-sm', type: 'button', text: '▼', disabled: index === sections.length - 1,
        attrs: { 'aria-label': `Move ${section.name} later` },
        on: { click: () => move(index, 1) }
      }),
      el('button', {
        className: 'icon-btn-sm icon-btn-danger', type: 'button', text: '×',
        attrs: { 'aria-label': `Remove ${section.name}` },
        on: { click: () => removeSection(section) }
      })
    ])
  ])));
}

async function addSectionFromInput() {
  const input = $('new-section-input');
  const name = input.value.trim();
  const store = currentStore();
  if (!name || !store) return;

  if (store.sections.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return toastError(`"${name}" is already a section of this store.`);
  }

  const nextOrder = (store.sections.at(-1)?.sort_order ?? 0) + 10;
  const { error } = await data.addSection(store.id, name, nextOrder);
  if (error) return toastError(friendlyError(error, 'Could not add that section.'));

  input.value = '';
  input.focus({ preventScroll: true });
  await data.loadStores();
  renderStoreDetail();
}

async function renameSection(section) {
  const name = await promptDialog({
    title: 'Rename section', label: 'Section name',
    value: section.name, submitLabel: 'Rename', maxLength: 60
  });
  if (!name || name === section.name) return;

  const { error } = await data.renameSection(section.id, name);
  if (error) return toastError(friendlyError(error, 'Could not rename that section.'));
  await data.loadStores();
  renderStoreDetail();
  // Items keep pointing at the same section id, so nothing else has to change.
}

async function move(index, delta) {
  const store = currentStore();
  if (!store) return;
  const ids = store.sections.map((s) => s.id);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];

  const { error } = await data.reorderSections(store.id, ids);
  if (error) return toastError(friendlyError(error, 'Could not reorder the sections.'));
  await data.loadStores();
  renderStoreDetail();
}

async function removeSection(section) {
  // Say how many groceries this affects before doing it, rather than silently
  // detaching them.
  const { count } = await data.countItemsInSection(section.id);
  const ok = await confirmDialog({
    title: `Remove "${section.name}"?`,
    message: count
      ? `${pluralise(count, 'item')} currently in this section will stay on their lists, shown as Unsorted.`
      : 'Nothing is assigned to this section.',
    confirmLabel: 'Remove', danger: true
  });
  if (!ok) return;

  const { error } = await data.deleteSection(section.id);
  if (error) return toastError(friendlyError(error, 'Could not remove that section.'));
  await data.loadStores();
  renderStoreDetail();
}

// -----------------------------------------------------------------------------
// One-time wiring
// -----------------------------------------------------------------------------
export function initStoresUi() {
  $('btn-create-store').addEventListener('click', createStoreFromInput);
  $('new-store-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createStoreFromInput();
  });
  $('btn-add-section').addEventListener('click', addSectionFromInput);
  $('new-section-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSectionFromInput(); }
  });

  data.on('stores', () => { renderStores(); if (activeStoreId) renderStoreDetail(); });
}
