// =============================================================================
// History: past shopping trips and archived lists
// =============================================================================
// The Firebase version stored only an item's text and note per trip and offered
// no way to look inside a trip at all. Here a trip opens, shows what was bought
// grouped by the section it came from, and every line has an "Add again" — plus
// "Add everything again" for recreating a whole trip.
//
// Adding again goes through the same RPC as quick-add, so an item already on the
// target list is merged instead of duplicated, and the user is told.
// =============================================================================

import { friendlyError } from './supabase.js';
import * as data from './data.js';
import {
  $, el, render, toast, toastError, actionSheet, confirmDialog, promptDialog,
  openOverlay, closeOverlay, formatDate, pluralise
} from './ui.js';
import { renderHome, addItemsToList, openListDetail } from './lists.js';

let activeTrip = null;
let activeTripItems = [];

// -----------------------------------------------------------------------------
// History tab
// -----------------------------------------------------------------------------
export function renderHistory() {
  renderTrips();
  renderArchived();
}

function renderTrips() {
  const container = $('history-container');
  if (!data.state.trips.length) {
    return render(container, el('p', {
      className: 'empty-state',
      text: 'No trips yet. Tick items off a list and choose "Finish shopping trip".'
    }));
  }

  render(container, data.state.trips.map((trip) => el('div', {
    className: 'history-item', attrs: { role: 'button', tabindex: '0' },
    on: {
      click: () => openTrip(trip),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrip(trip); } }
    }
  }, [
    el('div', { className: 'history-main-block' }, [
      el('span', { className: 'history-main', text: trip.list_name }),
      el('span', {
        className: 'history-sub',
        text: [formatDate(trip.completed_at), trip.store_name].filter(Boolean).join(' · ')
      })
    ]),
    el('span', { className: 'history-count', text: pluralise(trip.item_count, 'item') })
  ])));
}

function renderArchived() {
  const container = $('archived-lists-container');
  if (!data.state.archivedLists.length) {
    return render(container, el('p', {
      className: 'empty-state', text: 'Nothing archived.'
    }));
  }

  render(container, data.state.archivedLists.map((list) => el('div', { className: 'list-card' }, [
    el('div', { className: 'list-info' }, [
      el('span', { className: 'list-name', text: list.name }),
      el('span', { className: 'list-meta', text: `Archived ${formatDate(list.archived_at)}` })
    ]),
    el('div', { className: 'card-buttons' }, [
      el('button', {
        className: 'btn btn-outline btn-xs', type: 'button', text: 'Restore',
        on: { click: () => restore(list) }
      }),
      el('button', {
        className: 'btn btn-outline btn-xs btn-danger-text', type: 'button', text: 'Delete',
        on: { click: () => remove(list) }
      })
    ])
  ])));
}

async function restore(list) {
  const { error } = await data.archiveList(list.id, false);
  if (error) return toastError(friendlyError(error, 'Could not restore that list.'));
  await data.loadLists();
  renderHistory();
  renderHome();
  toast('List restored.');
}

async function remove(list) {
  const ok = await confirmDialog({
    title: `Delete "${list.name}"?`,
    message: 'The list and its remaining items go for good. Past trips stay in History.',
    confirmLabel: 'Delete', danger: true
  });
  if (!ok) return;
  const { error } = await data.deleteList(list.id);
  if (error) return toastError(friendlyError(error, 'Could not delete that list.'));
  await data.loadLists();
  renderHistory();
  toast('List deleted.');
}

// -----------------------------------------------------------------------------
// Trip detail
// -----------------------------------------------------------------------------
async function openTrip(trip) {
  activeTrip = trip;
  activeTripItems = await data.loadTripItems(trip.id).catch((error) => {
    toastError(friendlyError(error, 'Could not open that trip.'));
    return [];
  });

  openOverlay('view-trip-detail', {
    title: trip.list_name,
    onClose: () => { activeTrip = null; activeTripItems = []; }
  });

  $('trip-detail-name').textContent = trip.list_name;
  $('trip-detail-meta').textContent =
    [formatDate(trip.completed_at), trip.store_name, pluralise(trip.item_count, 'item')]
      .filter(Boolean).join(' · ');

  renderTripItems();
}

function renderTripItems() {
  const container = $('trip-items-container');
  if (!activeTripItems.length) {
    return render(container, el('p', { className: 'empty-state', text: 'This trip has no items recorded.' }));
  }

  const groups = new Map();
  for (const item of activeTripItems) {
    const key = item.section_name || 'Unsorted';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const nodes = [];
  for (const [sectionName, items] of groups) {
    if (groups.size > 1 || sectionName !== 'Unsorted') {
      nodes.push(el('h3', { className: 'section-header', text: sectionName }));
    }
    for (const item of items) {
      nodes.push(el('div', { className: 'item-row item-row-static' }, [
        el('div', { className: 'item-content item-content-static' }, [
          el('span', { className: 'item-line' }, [
            el('span', { className: 'item-text', text: item.name }),
            item.quantity && el('span', { className: 'item-qty', text: item.quantity })
          ]),
          item.note && el('span', { className: 'item-note', text: item.note })
        ]),
        el('button', {
          className: 'btn btn-outline btn-xs', type: 'button', text: 'Add again',
          on: { click: () => addAgain([item]) }
        })
      ]));
    }
  }
  render(container, nodes);
}

/**
 * Put historical items back on an active list. Asks which list when there is
 * more than one, and offers to create one when there are none.
 * @param {object[]} tripItems
 */
async function addAgain(tripItems) {
  const target = await chooseTargetList();
  if (!target) return;

  const payload = tripItems.map((item) => ({
    name: item.name,
    quantity: item.quantity || null,
    note: item.note || null
  }));

  const result = await addItemsToList(target.id, payload);
  if (!result) return;

  const parts = [];
  if (result.added) parts.push(`${pluralise(result.added, 'item')} added to ${target.name}`);
  if (result.merged) {
    const names = (result.merged_names || []).join(', ');
    parts.push(`${names} ${result.merged === 1 ? 'was' : 'were'} already there`);
  }
  toast(parts.join(' · ') || 'Nothing to add.', {
    tone: 'success',
    actionLabel: 'Open list',
    onAction: () => { closeOverlay(); openListDetail(target.id); }
  });
}

async function chooseTargetList() {
  const lists = data.state.lists;

  if (!lists.length) {
    const name = await promptDialog({
      title: 'Which list?', label: 'New list name',
      value: activeTrip?.list_name || 'Groceries', submitLabel: 'Create'
    });
    if (!name) return null;
    const { data: created, error } = await data.createList(name);
    if (error) { toastError(friendlyError(error, 'Could not create the list.')); return null; }
    await data.loadLists();
    return created;
  }

  if (lists.length === 1) return lists[0];

  const choice = await actionSheet({
    title: 'Add to which list?',
    actions: lists.map((list) => ({ label: list.name, value: list.id }))
  });
  return choice ? lists.find((l) => l.id === choice) : null;
}

// -----------------------------------------------------------------------------
// One-time wiring
// -----------------------------------------------------------------------------
export function initHistoryUi() {
  $('btn-add-all-again').addEventListener('click', () => {
    if (activeTripItems.length) addAgain(activeTripItems);
  });

  data.on('trips', renderHistory);
  data.on('lists', renderHistory);   // archived lists live on this tab too
}
