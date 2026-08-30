// =============================================================================
// Application state, data access and realtime synchronisation
// =============================================================================
// Everything that talks to Supabase lives here, so the view modules only ever
// read `state` and call the functions below.
//
// Sync strategy: when a realtime event arrives we re-fetch the affected slice
// rather than trying to patch the in-memory array from the payload. For a
// two-person grocery list the payloads are tiny and a refetch is always correct,
// whereas hand-applied deltas drift the moment an event is missed or arrives out
// of order. Refetches are debounced so a burst of changes costs one query.
//
// Note on offline: reads and writes both require connectivity. The service
// worker caches the app shell so the app opens offline, and `state.online`
// drives a banner, but there is no write queue — see README for what that means.
// =============================================================================

import { supabase } from './supabase.js';

export const state = {
  user: null,
  household: null,          // { id, name, role }
  members: [],
  lists: [],                // active (non-archived) lists
  archivedLists: [],
  stores: [],               // each with a `sections` array, ordered by sort_order
  trips: [],
  catalog: [],              // household_items, most-purchased first
  activeList: null,
  items: [],                // items of activeList
  online: typeof navigator === 'undefined' ? true : navigator.onLine
};

// -----------------------------------------------------------------------------
// Tiny event bus. Views subscribe to the slices they render.
// -----------------------------------------------------------------------------
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event) {
  for (const handler of listeners.get(event) || []) {
    try { handler(); } catch (error) { console.error('[young-lists] listener', event, error); }
  }
}

// -----------------------------------------------------------------------------
// Loaders
// -----------------------------------------------------------------------------

/** Resolve which household the signed-in user belongs to. */
export async function loadHousehold() {
  const { data, error } = await supabase
    .from('household_members')
    .select('role, household_id, households ( id, name )')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const row = (data || []).find((r) => r.households);
  state.household = row
    ? { id: row.households.id, name: row.households.name, role: row.role }
    : null;
  emit('household');
  return state.household;
}

export async function loadMembers() {
  if (!state.household) return [];
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, created_at')
    .eq('household_id', state.household.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  state.members = data || [];
  emit('members');
  return state.members;
}

export async function loadStores() {
  if (!state.household) return [];
  const [{ data: stores, error: storeError }, { data: sections, error: sectionError }] =
    await Promise.all([
      supabase.from('stores').select('*')
        .eq('household_id', state.household.id)
        .order('name', { ascending: true }),
      supabase.from('store_sections').select('*')
        .eq('household_id', state.household.id)
        .order('sort_order', { ascending: true })
    ]);
  if (storeError) throw storeError;
  if (sectionError) throw sectionError;

  state.stores = (stores || []).map((store) => ({
    ...store,
    sections: (sections || []).filter((s) => s.store_id === store.id)
  }));
  emit('stores');
  return state.stores;
}

export async function loadLists() {
  if (!state.household) return [];
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*, list_items ( id, checked )')
    .eq('household_id', state.household.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const withCounts = (data || []).map((list) => {
    const items = list.list_items || [];
    return {
      ...list,
      list_items: undefined,
      total_count: items.length,
      remaining_count: items.filter((i) => !i.checked).length
    };
  });
  state.lists = withCounts.filter((l) => !l.is_archived);
  state.archivedLists = withCounts.filter((l) => l.is_archived);
  emit('lists');
  return state.lists;
}

export async function loadTrips() {
  if (!state.household) return [];
  const { data, error } = await supabase
    .from('shopping_trips').select('*')
    .eq('household_id', state.household.id)
    .order('completed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  state.trips = data || [];
  emit('trips');
  return state.trips;
}

export async function loadTripItems(tripId) {
  const { data, error } = await supabase
    .from('shopping_trip_items').select('*')
    .eq('trip_id', tripId)
    .order('section_name', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadCatalog() {
  if (!state.household) return [];
  const { data, error } = await supabase
    .from('household_items').select('*')
    .eq('household_id', state.household.id)
    .order('times_purchased', { ascending: false })
    .limit(300);
  if (error) throw error;
  state.catalog = data || [];
  emit('catalog');
  return state.catalog;
}

/** Load everything the main screens need, in parallel. */
export async function loadAll() {
  await Promise.all([loadStores(), loadLists(), loadTrips(), loadCatalog(), loadMembers()]);
}

// -----------------------------------------------------------------------------
// Active list
// -----------------------------------------------------------------------------
export async function openList(listId) {
  const { data, error } = await supabase
    .from('shopping_lists').select('*').eq('id', listId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  state.activeList = data;
  await loadItems();
  emit('activeList');
  return data;
}

export function closeList() {
  state.activeList = null;
  state.items = [];
  emit('activeList');
}

export async function loadItems() {
  if (!state.activeList) return [];
  const { data, error } = await supabase
    .from('list_items').select('*')
    .eq('list_id', state.activeList.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  state.items = data || [];
  emit('items');
  return state.items;
}

/** Refresh the active list row itself (e.g. after someone else renames it). */
export async function reloadActiveList() {
  if (!state.activeList) return;
  const { data } = await supabase
    .from('shopping_lists').select('*').eq('id', state.activeList.id).maybeSingle();
  if (data) {
    state.activeList = data;
    emit('activeList');
  } else {
    // Somebody deleted it while we were looking at it.
    closeList();
  }
}

// -----------------------------------------------------------------------------
// Ordering helpers — the store walking order.
//
// Items are grouped by section and the groups are ordered by the section's
// sort_order *for the store this list is currently assigned to*. Anything with
// no section, or a section belonging to a different store, falls into a single
// "Unsorted" group at the end rather than disappearing.
// -----------------------------------------------------------------------------
const UNSORTED = { id: null, name: 'Unsorted', sort_order: Number.MAX_SAFE_INTEGER };

export function sectionsForActiveList() {
  const store = state.stores.find((s) => s.id === state.activeList?.store_id);
  return store ? store.sections : [];
}

/**
 * @param {object[]} items
 * @returns {{section: {id: string|null, name: string}, items: object[]}[]}
 */
export function groupItemsByRoute(items) {
  const sections = sectionsForActiveList();
  const byId = new Map(sections.map((s) => [s.id, s]));
  const groups = new Map();

  for (const item of items) {
    const section = byId.get(item.store_section_id) || UNSORTED;
    if (!groups.has(section.id)) groups.set(section.id, { section, items: [] });
    groups.get(section.id).items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.section.sort_order - b.section.sort_order);
}

// -----------------------------------------------------------------------------
// Realtime
//
// One channel per household carrying every table we care about. Re-subscribing
// always removes the previous channel first, so channels cannot accumulate as
// the user moves between lists or signs in and out.
// -----------------------------------------------------------------------------
let channel = null;
const timers = new Map();

function debounce(key, fn, wait = 150) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, wait));
}

const refresh = {
  lists: () => debounce('lists', () => { loadLists().catch(reportSyncError); }),
  items: () => debounce('items', () => {
    if (state.activeList) loadItems().catch(reportSyncError);
  }),
  activeList: () => debounce('activeList', () => {
    if (state.activeList) reloadActiveList().catch(reportSyncError);
  }),
  stores: () => debounce('stores', () => { loadStores().catch(reportSyncError); }),
  trips: () => debounce('trips', () => { loadTrips().catch(reportSyncError); }),
  catalog: () => debounce('catalog', () => { loadCatalog().catch(reportSyncError); }),
  members: () => debounce('members', () => { loadMembers().catch(reportSyncError); })
};

let syncErrorHandler = () => {};
export function onSyncError(handler) { syncErrorHandler = handler; }
function reportSyncError(error) { syncErrorHandler(error); }

let statusHandler = () => {};
export function onRealtimeStatus(handler) { statusHandler = handler; }

export async function subscribeRealtime() {
  await unsubscribeRealtime();
  if (!state.household) return;

  const householdFilter = `household_id=eq.${state.household.id}`;
  const table = (name, handler) => ({
    event: '*', schema: 'public', table: name, filter: householdFilter, handler
  });

  channel = supabase.channel(`household:${state.household.id}`);

  for (const spec of [
    table('shopping_lists', () => { refresh.lists(); refresh.activeList(); }),
    // Item changes also touch the parent list's updated_at, so Home reorders.
    table('list_items', () => { refresh.items(); refresh.lists(); }),
    table('stores', refresh.stores),
    table('store_sections', () => { refresh.stores(); refresh.items(); }),
    table('shopping_trips', refresh.trips),
    table('household_items', refresh.catalog),
    table('household_members', refresh.members)
  ]) {
    const { handler, ...config } = spec;
    channel.on('postgres_changes', config, handler);
  }

  channel.subscribe((status) => statusHandler(status));
}

export async function unsubscribeRealtime() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
}

// -----------------------------------------------------------------------------
// Mutations. Thin wrappers so error handling stays in one place per action and
// the view modules read like the user's intent.
// -----------------------------------------------------------------------------
const hh = () => state.household.id;

export const createHousehold = (name) =>
  supabase.rpc('create_household', { p_name: name });

export const joinHousehold = (code) =>
  supabase.rpc('redeem_household_invite', { p_code: code.toUpperCase().trim() });

export const createInvite = (hours = 168) =>
  supabase.rpc('create_household_invite', { p_household_id: hh(), p_ttl_hours: hours, p_max_uses: 1 });

export const removeMember = (userId) =>
  supabase.from('household_members').delete().eq('household_id', hh()).eq('user_id', userId);

export const createList = (name) =>
  supabase.from('shopping_lists').insert({ household_id: hh(), name }).select().single();

export const renameList = (id, name) =>
  supabase.from('shopping_lists').update({ name }).eq('id', id);

export const setListStore = (id, storeId) =>
  supabase.from('shopping_lists').update({ store_id: storeId || null }).eq('id', id);

export const archiveList = (id, archived) =>
  supabase.from('shopping_lists')
    .update({ is_archived: archived, archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id);

export const deleteList = (id) =>
  supabase.from('shopping_lists').delete().eq('id', id);

/**
 * Add one or more items. Goes through the RPC so quick-add, "Add again" and
 * "Add all again" all get the same merge-instead-of-duplicate behaviour and the
 * same remembered defaults.
 * @param {string} listId
 * @param {Array<{name: string, quantity?: string, note?: string, store_section_id?: string|null}>} items
 */
export const addItems = (listId, items) =>
  supabase.rpc('add_items_to_list', { p_list_id: listId, p_items: items });

export const updateItem = (id, patch) =>
  supabase.from('list_items').update(patch).eq('id', id);

export const deleteItem = (id) =>
  supabase.from('list_items').delete().eq('id', id);

export const restoreItem = (item) =>
  supabase.from('list_items').insert({
    list_id: item.list_id, household_id: item.household_id, name: item.name,
    quantity: item.quantity, note: item.note, store_section_id: item.store_section_id,
    checked: item.checked
  });

export const completeTrip = (listId) =>
  supabase.rpc('complete_shopping_trip', { p_list_id: listId });

export const createStore = (name, location, sections) =>
  supabase.rpc('create_store_with_sections', {
    p_household_id: hh(), p_name: name,
    p_location: location || null, p_sections: sections || []
  });

export const updateStore = (id, patch) =>
  supabase.from('stores').update(patch).eq('id', id);

export const deleteStore = (id) =>
  supabase.from('stores').delete().eq('id', id);

export const addSection = (storeId, name, sortOrder) =>
  supabase.from('store_sections')
    .insert({ store_id: storeId, household_id: hh(), name, sort_order: sortOrder });

export const renameSection = (id, name) =>
  supabase.from('store_sections').update({ name }).eq('id', id);

export const deleteSection = (id) =>
  supabase.from('store_sections').delete().eq('id', id);

export const reorderSections = (storeId, sectionIds) =>
  supabase.rpc('reorder_store_sections', { p_store_id: storeId, p_section_ids: sectionIds });

export const countItemsInSection = (sectionId) =>
  supabase.from('list_items')
    .select('id', { count: 'exact', head: true })
    .eq('store_section_id', sectionId);
