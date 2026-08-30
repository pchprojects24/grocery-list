// =============================================================================
// Lists: the Home tab and the shopping-mode list detail screen
// =============================================================================
// Shopping mode priorities, in order: big tap targets, one thumb, the route
// through the store, and an undo for every destructive tap.
//
// Checked items are not deleted when ticked — they drop to a "Picked up" group
// at the bottom of the list, greyed out, and stay there until the trip is
// completed. A mis-tap is one tap to reverse.
// =============================================================================

import { friendlyError } from './supabase.js';
import * as data from './data.js';
import {
  $, el, render, clear, show, toast, toastError, confirmDialog, formDialog,
  promptDialog, actionSheet, openOverlay, closeOverlay, updateOverlayHeader,
  pluralise
} from './ui.js';

// -----------------------------------------------------------------------------
// Home tab
// -----------------------------------------------------------------------------
export function renderHome() {
  const container = $('lists-container');

  if (!data.state.lists.length) {
    return render(container, el('p', {
      className: 'empty-state',
      text: 'No lists yet. Create one below — "Groceries" is a good start.'
    }));
  }

  render(container, data.state.lists.map((list) => {
    const store = data.state.stores.find((s) => s.id === list.store_id);
    const meta = [
      list.total_count
        ? `${list.remaining_count} of ${list.total_count} left`
        : 'Empty',
      store && storeLabel(store)
    ].filter(Boolean).join(' · ');

    return el('div', {
      className: 'list-card', attrs: { role: 'button', tabindex: '0' },
      on: {
        click: () => openListDetail(list.id),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openListDetail(list.id); } }
      }
    }, [
      el('div', { className: 'list-info' }, [
        el('span', { className: 'list-name', text: list.name }),
        el('span', { className: 'list-meta', text: meta })
      ]),
      el('button', {
        className: 'list-actions-btn', type: 'button',
        attrs: { 'aria-label': `Actions for ${list.name}` }, text: '⋯',
        on: { click: (event) => { event.stopPropagation(); listActions(list); } }
      })
    ]);
  }));
}

function storeLabel(store) {
  return store.location ? `${store.name} (${store.location})` : store.name;
}

async function createListFromInput() {
  const input = $('new-list-name');
  const name = input.value.trim();
  if (!name) return;

  const { data: created, error } = await data.createList(name);
  if (error) return toastError(friendlyError(error, 'Could not create the list.'));
  input.value = '';
  await data.loadLists();
  renderHome();
  if (created) openListDetail(created.id);
}

async function listActions(list) {
  const choice = await actionSheet({
    title: list.name,
    actions: [
      { label: 'Open', value: 'open' },
      { label: 'Rename', value: 'rename' },
      { label: list.is_archived ? 'Restore to lists' : 'Archive', value: 'archive',
        description: list.is_archived ? null : 'Keeps it out of the way without deleting it' },
      { label: 'Delete', value: 'delete', danger: true,
        description: 'Removes the list and everything on it' }
    ]
  });
  if (!choice) return;

  if (choice === 'open') return openListDetail(list.id);

  if (choice === 'rename') {
    const name = await promptDialog({
      title: 'Rename list', label: 'List name', value: list.name, submitLabel: 'Rename'
    });
    if (!name) return;
    const { error } = await data.renameList(list.id, name);
    if (error) return toastError(friendlyError(error, 'Could not rename the list.'));
    await data.loadLists();
    renderHome();
    return;
  }

  if (choice === 'archive') {
    const { error } = await data.archiveList(list.id, !list.is_archived);
    if (error) return toastError(friendlyError(error, 'Could not archive the list.'));
    await data.loadLists();
    renderHome();
    toast(list.is_archived ? 'List restored.' : 'List archived.');
    return;
  }

  if (choice === 'delete') {
    const ok = await confirmDialog({
      title: `Delete "${list.name}"?`,
      message: 'The list and every item on it will be removed. Completed shopping trips stay in History.',
      confirmLabel: 'Delete', danger: true
    });
    if (!ok) return;
    const { error } = await data.deleteList(list.id);
    if (error) return toastError(friendlyError(error, 'Could not delete the list.'));
    await data.loadLists();
    renderHome();
    toast('List deleted.');
  }
}

// -----------------------------------------------------------------------------
// List detail (shopping mode)
// -----------------------------------------------------------------------------
let searchTerm = '';

export async function openListDetail(listId) {
  const list = await data.openList(listId).catch((error) => {
    toastError(friendlyError(error, 'Could not open that list.'));
    return null;
  });
  if (!list) return;

  searchTerm = '';
  $('item-search').value = '';

  openOverlay('view-list-detail', {
    title: list.name,
    menu: listDetailMenu,
    onClose: () => data.closeList()
  });

  populateStoreSelect();
  populateSectionSelect();
  renderQuickPicks();
  renderItems();
  $('quick-add-input').focus({ preventScroll: true });
}

/** Re-render everything that depends on the active list. Safe to call often. */
export function refreshListDetail() {
  if (!data.state.activeList) return;
  updateOverlayHeader(data.state.activeList.name, listDetailMenu);
  populateStoreSelect();
  populateSectionSelect();
  renderItems();
}

function populateStoreSelect() {
  const select = $('list-store-select');
  const current = data.state.activeList?.store_id || '';
  render(select, [
    el('option', { value: '', text: 'No store — order added' }),
    ...data.state.stores.map((store) =>
      el('option', { value: store.id, text: storeLabel(store), selected: store.id === current }))
  ]);
  select.value = current;
}

function populateSectionSelect() {
  const select = $('quick-add-section');
  const previous = select.value;
  const sections = data.sectionsForActiveList();
  render(select, [
    el('option', { value: '', text: 'No section' }),
    ...sections.map((s) => el('option', { value: s.id, text: s.name }))
  ]);
  // Keep the shopper's choice if that section still exists.
  select.value = sections.some((s) => s.id === previous) ? previous : '';
  show(select, sections.length > 0);
}

// -----------------------------------------------------------------------------
// Quick picks — what the household buys most often, one tap to add.
// This is the replacement for the old hard-coded Templates tab, which was not
// reachable from the navigation bar at all.
// -----------------------------------------------------------------------------
function renderQuickPicks() {
  const host = $('quick-picks');
  const onList = new Set(data.state.items.filter((i) => !i.checked)
    .map((i) => i.name.trim().toLowerCase()));

  const picks = data.state.catalog
    .filter((entry) => entry.times_purchased > 0 && !onList.has(entry.normalized_name))
    .slice(0, 8);

  show(host, picks.length > 0);
  if (!picks.length) return clear(host);

  render(host, [
    el('span', { className: 'chip-label', text: 'Often bought' }),
    ...picks.map((entry) => el('button', {
      className: 'chip', type: 'button', text: entry.display_name,
      on: { click: () => addItems([{ name: entry.display_name }]) }
    }))
  ]);
}

function renderCatalogSuggestions() {
  render($('catalog-suggestions'), data.state.catalog.slice(0, 200)
    .map((entry) => el('option', { value: entry.display_name })));
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------
export function renderItems() {
  const container = $('list-items-container');
  const term = searchTerm.trim().toLowerCase();

  const visible = term
    ? data.state.items.filter((item) =>
        item.name.toLowerCase().includes(term) ||
        (item.note || '').toLowerCase().includes(term))
    : data.state.items;

  const outstanding = visible.filter((item) => !item.checked);
  const picked = visible.filter((item) => item.checked);

  const nodes = [];

  if (!visible.length) {
    nodes.push(el('p', {
      className: 'empty-state',
      text: term
        ? 'Nothing on this list matches that search.'
        : 'Nothing on this list yet. Add something below.'
    }));
  }

  for (const group of data.groupItemsByRoute(outstanding)) {
    if (data.sectionsForActiveList().length) {
      nodes.push(el('h3', { className: 'section-header', text: group.section.name }));
    }
    nodes.push(...group.items.map(itemRow));
  }

  if (picked.length) {
    nodes.push(el('h3', { className: 'section-header section-header-done' },
      [`Picked up · ${picked.length}`]));
    nodes.push(...picked.map(itemRow));
  }

  render(container, nodes);
  renderQuickPicks();
  renderCatalogSuggestions();
}

function itemRow(item) {
  const checkbox = el('input', {
    type: 'checkbox', className: 'item-checkbox', checked: item.checked,
    attrs: { 'aria-label': item.name },
    on: { change: (event) => setChecked(item, event.target.checked) }
  });

  const details = [el('span', { className: 'item-text', text: item.name })];
  if (item.quantity) details.push(el('span', { className: 'item-qty', text: item.quantity }));

  return el('div', { className: `item-row${item.checked ? ' item-checked' : ''}` }, [
    el('label', { className: 'item-check-target' }, [checkbox]),
    el('button', {
      className: 'item-content', type: 'button',
      attrs: { 'aria-label': `Edit ${item.name}` },
      on: { click: () => editItem(item) }
    }, [
      el('span', { className: 'item-line' }, details),
      item.note && el('span', { className: 'item-note', text: item.note })
    ]),
    el('button', {
      className: 'item-delete', type: 'button', text: '×',
      attrs: { 'aria-label': `Remove ${item.name}` },
      on: { click: () => removeItem(item) }
    })
  ]);
}

async function setChecked(item, checked) {
  const { error } = await data.updateItem(item.id, { checked });
  if (error) {
    toastError(friendlyError(error, 'Could not save that.'));
    return data.loadItems().then(renderItems);
  }
  item.checked = checked;                 // optimistic; realtime confirms
  renderItems();
}

async function removeItem(item) {
  const { error } = await data.deleteItem(item.id);
  if (error) return toastError(friendlyError(error, 'Could not remove that item.'));

  data.state.items = data.state.items.filter((i) => i.id !== item.id);
  renderItems();

  toast(`Removed ${item.name}.`, {
    actionLabel: 'Undo',
    onAction: async () => {
      const { error: undoError } = await data.restoreItem(item);
      if (undoError) return toastError(friendlyError(undoError, 'Could not undo that.'));
      await data.loadItems();
      renderItems();
    }
  });
}

async function editItem(item) {
  const sections = data.sectionsForActiveList();
  const result = await formDialog({
    title: 'Edit item',
    submitLabel: 'Save',
    fields: [
      { name: 'name', label: 'Item', value: item.name, required: true, maxLength: 120 },
      { name: 'quantity', label: 'Quantity (optional)', value: item.quantity || '',
        placeholder: 'e.g. 2, 500 g, a dozen', maxLength: 40 },
      { name: 'note', label: 'Note (optional)', value: item.note || '',
        type: 'textarea', placeholder: 'e.g. the oat one, not the almond', maxLength: 500 },
      sections.length && {
        name: 'store_section_id', label: 'Section', type: 'select',
        value: item.store_section_id || '',
        options: [{ value: '', label: 'No section' },
                  ...sections.map((s) => ({ value: s.id, label: s.name }))]
      }
    ].filter(Boolean)
  });
  if (!result) return;

  const patch = {
    name: result.name,
    quantity: result.quantity || null,
    note: result.note || null
  };
  if ('store_section_id' in result) patch.store_section_id = result.store_section_id || null;

  const { error } = await data.updateItem(item.id, patch);
  if (error) return toastError(friendlyError(error, 'Could not save that item.'));
  await data.loadItems();
  renderItems();
}

/**
 * Add items to the active list.
 * @param {Array<{name: string, quantity?: string, note?: string, store_section_id?: string|null}>} items
 */
async function addItems(items) {
  if (!data.state.activeList || !items.length) return;

  const { data: result, error } = await data.addItems(data.state.activeList.id, items);
  if (error) return toastError(friendlyError(error, 'Could not add that.'));

  await data.loadItems();
  renderItems();

  if (result && result.merged > 0) {
    const names = (result.merged_names || []).join(', ');
    toast(`${names} ${result.merged === 1 ? 'was' : 'were'} already on the list, so nothing was duplicated.`);
  }
}

function handleQuickAdd() {
  const input = $('quick-add-input');
  const raw = input.value;
  if (!raw.trim()) return;

  const sectionId = $('quick-add-section').value || null;
  // "milk, eggs, bread" adds three items — a feature worth keeping.
  const items = raw.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => ({ name, store_section_id: sectionId }));

  input.value = '';
  input.focus({ preventScroll: true });
  addItems(items);
}

// -----------------------------------------------------------------------------
// List menu (the ⋯ button in the header)
// -----------------------------------------------------------------------------
async function listDetailMenu() {
  const list = data.state.activeList;
  if (!list) return;

  const checked = data.state.items.filter((i) => i.checked).length;
  const choice = await actionSheet({
    title: list.name,
    subtitle: checked
      ? `${pluralise(checked, 'item')} ticked off`
      : 'Nothing ticked off yet',
    actions: [
      { label: 'Finish shopping trip', value: 'complete',
        description: 'Moves ticked items into History' },
      { label: 'Rename list', value: 'rename' },
      { label: 'Clear ticked items', value: 'clear', danger: true,
        description: 'Removes them without recording a trip' },
      { label: 'Archive list', value: 'archive' },
      { label: 'Delete list', value: 'delete', danger: true }
    ]
  });
  if (!choice) return;

  if (choice === 'complete') return completeTrip();

  if (choice === 'rename') {
    const name = await promptDialog({
      title: 'Rename list', label: 'List name', value: list.name, submitLabel: 'Rename'
    });
    if (!name) return;
    const { error } = await data.renameList(list.id, name);
    if (error) return toastError(friendlyError(error, 'Could not rename the list.'));
    await data.reloadActiveList();
    await data.loadLists();
    refreshListDetail();
    renderHome();
    return;
  }

  if (choice === 'clear') {
    const ok = await confirmDialog({
      title: 'Clear ticked items?',
      message: 'They will be removed without being recorded as a shopping trip.',
      confirmLabel: 'Clear', danger: true
    });
    if (!ok) return;
    for (const item of data.state.items.filter((i) => i.checked)) {
      await data.deleteItem(item.id);
    }
    await data.loadItems();
    renderItems();
    return;
  }

  if (choice === 'archive') {
    const { error } = await data.archiveList(list.id, true);
    if (error) return toastError(friendlyError(error, 'Could not archive the list.'));
    closeOverlay();
    await data.loadLists();
    renderHome();
    toast('List archived.');
    return;
  }

  if (choice === 'delete') {
    const ok = await confirmDialog({
      title: `Delete "${list.name}"?`,
      message: 'The list and every item on it will be removed. Completed trips stay in History.',
      confirmLabel: 'Delete', danger: true
    });
    if (!ok) return;
    const { error } = await data.deleteList(list.id);
    if (error) return toastError(friendlyError(error, 'Could not delete the list.'));
    closeOverlay();
    await data.loadLists();
    renderHome();
    toast('List deleted.');
  }
}

async function completeTrip() {
  const list = data.state.activeList;
  const checked = data.state.items.filter((i) => i.checked);
  if (!checked.length) {
    return toast('Tick off what you bought first, then finish the trip.');
  }

  const remaining = data.state.items.length - checked.length;
  const ok = await confirmDialog({
    title: 'Finish this shopping trip?',
    message: `${pluralise(checked.length, 'item')} will move into History.` +
      (remaining ? ` ${pluralise(remaining, 'item')} stays on the list for next time.` : ''),
    confirmLabel: 'Finish trip'
  });
  if (!ok) return;

  const { error } = await data.completeTrip(list.id);
  if (error) return toastError(friendlyError(error, 'Could not finish the trip.'));

  await Promise.all([data.loadItems(), data.loadTrips(), data.loadCatalog(), data.loadLists()]);
  renderItems();
  renderHome();
  toast('Trip saved to History.', { tone: 'success' });
}

// -----------------------------------------------------------------------------
// One-time wiring. Called once from app.js; nothing here is ever re-registered.
// -----------------------------------------------------------------------------
export function initListsUi() {
  $('btn-create-list').addEventListener('click', createListFromInput);
  $('new-list-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createListFromInput();
  });

  $('btn-quick-add').addEventListener('click', handleQuickAdd);
  $('quick-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(); }
  });

  $('item-search').addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderItems();
  });

  $('list-store-select').addEventListener('change', async (event) => {
    const list = data.state.activeList;
    if (!list) return;
    const storeId = event.target.value || null;
    const { error } = await data.setListStore(list.id, storeId);
    if (error) return toastError(friendlyError(error, 'Could not change the store.'));
    list.store_id = storeId;
    populateSectionSelect();
    renderItems();
  });

  data.on('items', renderItems);
  data.on('lists', renderHome);
  data.on('catalog', () => { if (data.state.activeList) renderItems(); });
  data.on('activeList', () => { if (data.state.activeList) refreshListDetail(); });
  data.on('stores', () => {
    renderHome();
    if (data.state.activeList) { populateStoreSelect(); populateSectionSelect(); renderItems(); }
  });
}

/** Used by History's "Add again" to drop items onto a chosen list. */
export async function addItemsToList(listId, items) {
  const { data: result, error } = await data.addItems(listId, items);
  if (error) {
    toastError(friendlyError(error, 'Could not add those items.'));
    return null;
  }
  if (data.state.activeList?.id === listId) {
    await data.loadItems();
    renderItems();
  }
  await data.loadLists();
  renderHome();
  return result;
}
