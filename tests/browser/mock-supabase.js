// =============================================================================
// In-memory stand-in for supabase-js, used only by tests/browser/run.mjs
// =============================================================================
// Playwright serves this file in place of vendor/supabase-js-*.umd.js, so the
// application code, index.html and styles.css under test are the real, unedited
// files. Only the network layer is swapped.
//
// It implements the subset of the client the app actually uses, with the same
// semantics as the SQL: merge-instead-of-duplicate on add, cascade on list
// delete, catalog updates on trip completion, and so on.
//
// This is NOT a substitute for testing the real database — RLS, cascades and
// the RPCs are tested against a real PostgreSQL server by tests/run_db_tests.sh.
// This mock exists to test rendering, escaping, navigation and interaction.
// =============================================================================

(function () {
  const uuid = (() => {
    let n = 0;
    return (prefix) => `${prefix}-${String(++n).padStart(4, '0')}-0000-0000-000000000000`;
  })();

  const now = () => new Date().toISOString();
  const norm = (s) => String(s || '').trim().toLowerCase();

  const db = {
    users: [{ id: 'user-alice', email: 'alice@example.com', password: 'password123' }],
    households: [],
    household_members: [],
    household_invites: [],
    stores: [],
    store_sections: [],
    shopping_lists: [],
    list_items: [],
    shopping_trips: [],
    shopping_trip_items: [],
    household_items: []
  };

  let session = null;
  const authListeners = [];
  const channels = [];

  const ok = (data) => Promise.resolve({ data, error: null, count: null });
  const fail = (message, code) => Promise.resolve({ data: null, error: { message, code } });

  // ---------------------------------------------------------------- query ---
  function builder(table) {
    const q = {
      _table: table,
      _filters: [],
      _orders: [],
      _limit: null,
      _single: null,
      _head: false,
      _count: false,
      _select: '*',
      _op: 'select',
      _payload: null
    };

    const api = {
      select(columns = '*', options = {}) {
        q._select = columns;
        if (options.head) q._head = true;
        if (options.count) q._count = true;
        if (q._op === 'select') q._op = 'select';
        return api;
      },
      eq(column, value) { q._filters.push([column, value]); return api; },
      order(column, options = {}) { q._orders.push([column, options.ascending !== false]); return api; },
      limit(n) { q._limit = n; return api; },
      maybeSingle() { q._single = 'maybe'; return api.then.call(api, (r) => r); },
      single() { q._single = 'one'; return api; },
      insert(payload) { q._op = 'insert'; q._payload = payload; return api; },
      update(payload) { q._op = 'update'; q._payload = payload; return api; },
      delete() { q._op = 'delete'; return api; },
      then(resolve, reject) { return run(q).then(resolve, reject); }
    };
    // maybeSingle above returns a promise already; keep the simple form.
    api.maybeSingle = () => { q._single = 'maybe'; return run(q); };
    api.single = () => { q._single = 'one'; return run(q); };
    return api;
  }

  function matches(row, filters) {
    return filters.every(([column, value]) => row[column] === value);
  }

  function run(q) {
    const rows = db[q._table] || [];

    if (q._op === 'insert') {
      const payloads = Array.isArray(q._payload) ? q._payload : [q._payload];
      const created = payloads.map((payload) => {
        const row = {
          id: payload.id || uuid(q._table.slice(0, 4)),
          created_at: now(),
          updated_at: now(),
          created_by: session?.user.id ?? null,
          ...payload
        };
        if (q._table === 'list_items') {
          row.checked = Boolean(row.checked);
          row.checked_at = row.checked ? now() : null;
        }
        rows.push(row);
        return row;
      });
      notify(q._table);
      if (q._single === 'one') return ok(created[0]);
      return ok(created);
    }

    if (q._op === 'update') {
      const affected = rows.filter((row) => matches(row, q._filters));
      for (const row of affected) {
        if ('checked' in q._payload && q._payload.checked !== row.checked) {
          row.checked_at = q._payload.checked ? now() : null;
        }
        Object.assign(row, q._payload, { updated_at: now() });
      }
      notify(q._table);
      return ok(affected);
    }

    if (q._op === 'delete') {
      const keep = [];
      const removed = [];
      for (const row of rows) (matches(row, q._filters) ? removed : keep).push(row);
      db[q._table] = keep;
      // The real schema uses ON DELETE CASCADE / SET NULL; mirror it here.
      if (q._table === 'shopping_lists') {
        for (const list of removed) {
          db.list_items = db.list_items.filter((i) => i.list_id !== list.id);
          for (const trip of db.shopping_trips) {
            if (trip.shopping_list_id === list.id) trip.shopping_list_id = null;
          }
        }
        notify('list_items');
      }
      if (q._table === 'stores') {
        for (const store of removed) {
          const sectionIds = db.store_sections.filter((s) => s.store_id === store.id).map((s) => s.id);
          db.store_sections = db.store_sections.filter((s) => s.store_id !== store.id);
          for (const item of db.list_items) {
            if (sectionIds.includes(item.store_section_id)) item.store_section_id = null;
          }
          for (const list of db.shopping_lists) {
            if (list.store_id === store.id) list.store_id = null;
          }
        }
        notify('store_sections');
        notify('shopping_lists');
      }
      if (q._table === 'store_sections') {
        for (const section of removed) {
          for (const item of db.list_items) {
            if (item.store_section_id === section.id) item.store_section_id = null;
          }
        }
        notify('list_items');
      }
      notify(q._table);
      return ok(removed);
    }

    // select
    let result = rows.filter((row) => matches(row, q._filters));

    if (q._head && q._count) return Promise.resolve({ data: null, error: null, count: result.length });

    for (const [column, ascending] of [...q._orders].reverse()) {
      result = [...result].sort((a, b) => {
        const av = a[column], bv = b[column];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (q._limit) result = result.slice(0, q._limit);

    // Embedded selects the app uses.
    if (q._table === 'shopping_lists' && q._select.includes('list_items')) {
      result = result.map((list) => ({
        ...list,
        list_items: db.list_items.filter((i) => i.list_id === list.id)
          .map((i) => ({ id: i.id, checked: i.checked }))
      }));
    }
    if (q._table === 'household_members' && q._select.includes('households')) {
      result = result.map((member) => ({
        ...member,
        households: db.households.find((h) => h.id === member.household_id) || null
      }));
    }

    if (q._single === 'maybe') return ok(result[0] ?? null);
    if (q._single === 'one') {
      return result.length ? ok(result[0]) : fail('No rows found', 'PGRST116');
    }
    return ok(result);
  }

  // ------------------------------------------------------------------ rpc ---
  const rpcs = {
    create_household({ p_name }) {
      const household = { id: uuid('hh'), name: p_name.trim(), created_by: session.user.id, created_at: now(), updated_at: now() };
      db.households.push(household);
      db.household_members.push({
        household_id: household.id, user_id: session.user.id, role: 'owner', created_at: now()
      });
      return household.id;
    },

    create_household_invite({ p_household_id }) {
      const code = 'TESTCODE';
      db.household_invites.push({
        code, household_id: p_household_id, created_by: session.user.id,
        created_at: now(), expires_at: now(), max_uses: 1, uses: 0, revoked_at: null
      });
      return code;
    },

    redeem_household_invite({ p_code }) {
      const invite = db.household_invites.find((i) => i.code === p_code && i.uses < i.max_uses);
      if (!invite) throw { message: 'That invite code is not valid', code: '22023' };
      invite.uses += 1;
      db.household_members.push({
        household_id: invite.household_id, user_id: session.user.id, role: 'member', created_at: now()
      });
      return invite.household_id;
    },

    create_store_with_sections({ p_household_id, p_name, p_location, p_sections }) {
      const store = {
        id: uuid('st'), household_id: p_household_id, name: p_name.trim(),
        location: p_location || null, created_at: now(), updated_at: now()
      };
      db.stores.push(store);
      (p_sections || []).forEach((name, index) => {
        db.store_sections.push({
          id: uuid('sec'), store_id: store.id, household_id: p_household_id,
          name: name.trim(), sort_order: (index + 1) * 10, created_at: now(), updated_at: now()
        });
      });
      notify('stores'); notify('store_sections');
      return store.id;
    },

    reorder_store_sections({ p_store_id, p_section_ids }) {
      p_section_ids.forEach((id, index) => {
        const section = db.store_sections.find((s) => s.id === id && s.store_id === p_store_id);
        if (section) section.sort_order = (index + 1) * 10;
      });
      notify('store_sections');
      return null;
    },

    add_items_to_list({ p_list_id, p_items }) {
      const list = db.shopping_lists.find((l) => l.id === p_list_id);
      if (!list) throw { message: 'List not found', code: '42501' };

      let added = 0, merged = 0;
      const mergedNames = [];

      for (const raw of p_items) {
        const name = String(raw.name || '').trim();
        if (!name) continue;
        const key = norm(name);

        const catalog = db.household_items.find(
          (c) => c.household_id === list.household_id && c.normalized_name === key);
        let quantity = raw.quantity || catalog?.default_quantity || null;
        let note = raw.note || catalog?.default_note || null;
        let sectionId = raw.store_section_id || null;
        if (!sectionId && catalog?.preferred_section_id) {
          const section = db.store_sections.find((s) => s.id === catalog.preferred_section_id);
          if (section && section.store_id === list.store_id) sectionId = section.id;
        }

        const existing = db.list_items.find(
          (i) => i.list_id === p_list_id && !i.checked && norm(i.name) === key);
        if (existing) {
          existing.quantity = quantity ?? existing.quantity;
          existing.note = note ?? existing.note;
          existing.store_section_id = sectionId ?? existing.store_section_id;
          existing.updated_at = now();
          merged += 1;
          mergedNames.push(name);
        } else {
          db.list_items.push({
            id: uuid('item'), list_id: p_list_id, household_id: list.household_id,
            name, quantity, note, store_section_id: sectionId, checked: false,
            checked_at: null, created_by: session.user.id, created_at: now(), updated_at: now()
          });
          added += 1;
        }
      }
      list.updated_at = now();
      notify('list_items'); notify('shopping_lists');
      return { added, merged, merged_names: mergedNames };
    },

    complete_shopping_trip({ p_list_id }) {
      const list = db.shopping_lists.find((l) => l.id === p_list_id);
      const checked = db.list_items.filter((i) => i.list_id === p_list_id && i.checked);
      if (!checked.length) throw { message: 'NO_CHECKED_ITEMS', code: '22023' };

      const store = db.stores.find((s) => s.id === list.store_id);
      const storeName = store ? store.name + (store.location ? ` (${store.location})` : '') : null;

      const trip = {
        id: uuid('trip'), household_id: list.household_id, shopping_list_id: list.id,
        list_name: list.name, store_id: store?.id ?? null, store_name: storeName,
        item_count: checked.length, completed_by: session.user.id, completed_at: now()
      };
      db.shopping_trips.push(trip);

      for (const item of checked) {
        const section = db.store_sections.find((s) => s.id === item.store_section_id);
        db.shopping_trip_items.push({
          id: uuid('ti'), trip_id: trip.id, household_id: list.household_id,
          name: item.name, quantity: item.quantity, note: item.note,
          store_name: storeName, section_name: section?.name ?? null,
          source_item_id: item.id, purchased_at: item.checked_at || now()
        });

        const key = norm(item.name);
        const entry = db.household_items.find(
          (c) => c.household_id === list.household_id && c.normalized_name === key);
        if (entry) {
          entry.times_purchased += 1;
          entry.last_purchased_at = now();
          entry.display_name = item.name;
          entry.default_quantity = item.quantity ?? entry.default_quantity;
          entry.preferred_section_id = item.store_section_id ?? entry.preferred_section_id;
        } else {
          db.household_items.push({
            id: uuid('cat'), household_id: list.household_id, display_name: item.name,
            normalized_name: key, default_quantity: item.quantity, default_note: item.note,
            preferred_store_id: list.store_id, preferred_section_id: item.store_section_id,
            times_purchased: 1, last_purchased_at: now(), created_at: now(), updated_at: now()
          });
        }
      }

      db.list_items = db.list_items.filter((i) => !(i.list_id === p_list_id && i.checked));
      notify('list_items'); notify('shopping_trips'); notify('household_items'); notify('shopping_lists');
      return trip.id;
    }
  };

  // ------------------------------------------------------------- realtime ---
  function notify(table) {
    for (const channel of channels) {
      for (const handler of channel.handlers.filter((h) => h.table === table)) {
        handler.callback({ table, eventType: 'CHANGE' });
      }
    }
  }

  // ----------------------------------------------------------------- auth ---
  function emitAuth(event) {
    for (const listener of authListeners) listener(event, session);
  }

  const auth = {
    async signInWithPassword({ email, password }) {
      const user = db.users.find((u) => u.email === email && u.password === password);
      if (!user) {
        return { data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials' } };
      }
      window.__signInCount = (window.__signInCount || 0) + 1;
      session = { user: { id: user.id, email: user.email } };
      emitAuth('SIGNED_IN');
      return { data: { session }, error: null };
    },
    async signUp({ email, password }) {
      if (db.users.some((u) => u.email === email)) {
        return { data: null, error: { message: 'exists', code: 'user_already_exists' } };
      }
      const user = { id: uuid('user'), email, password };
      db.users.push(user);
      session = { user: { id: user.id, email: user.email } };
      emitAuth('SIGNED_IN');
      return { data: { user, session }, error: null };
    },
    async signOut() {
      session = null;
      emitAuth('SIGNED_OUT');
      return { error: null };
    },
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(listener) {
      authListeners.push(listener);
      return { data: { subscription: { unsubscribe() {} } } };
    }
  };

  // --------------------------------------------------------------- client ---
  function createClient() {
    return {
      auth,
      from: builder,
      rpc(name, args) {
        try {
          return ok(rpcs[name](args || {}));
        } catch (error) {
          return Promise.resolve({ data: null, error });
        }
      },
      channel(name) {
        const channel = {
          name,
          handlers: [],
          on(_type, config, callback) {
            channel.handlers.push({ table: config.table, callback });
            return channel;
          },
          subscribe(cb) { if (cb) cb('SUBSCRIBED'); return channel; }
        };
        channels.push(channel);
        window.__channelCount = channels.length;
        return channel;
      },
      removeChannel(channel) {
        const index = channels.indexOf(channel);
        if (index >= 0) channels.splice(index, 1);
        window.__channelCount = channels.length;
        return Promise.resolve('ok');
      }
    };
  }

  window.supabase = { createClient };

  // Hooks for the test runner: inspect state, and pretend to be the other phone.
  window.__db = db;
  window.__notify = notify;
  window.__openChannels = () => channels.length;
})();
