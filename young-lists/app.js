
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    doc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    getDoc,
    getDocs,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
// User must paste their config here in step 5
const firebaseConfig = {
    // PASTE YOUR FIREBASE CONFIG OBJECT HERE
    // apiKey: "...",
    // authDomain: "...",
    // projectId: "...",
    // ...
};

// Placeholder check
if (!firebaseConfig.apiKey) {
    console.error("Firebase Config missing! Please edit app.js.");
    alert("Setup Required: Please edit app.js and paste your Firebase Config.");
}

// --- INIT FIREBASE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- STATE ---
const state = {
    user: null, // Auth user
    allowedUids: [], // From meta/allowedUsers
    isAllowed: false, // Computed permission
    lists: [], // Active lists snapshot
    activeListId: null, // Currently viewing list ID
    activeListStoreId: null, // Store associated with active list
    stores: [], // All stores
    activeStoreId: null, // Currently editing store
    currentItemsSnapshot: null, // Cache for re-rendering items
    unsubscribeLists: null,
    unsubscribeItems: null,
    unsubscribeAllowed: null,
    unsubscribeStores: null
};

// --- DOM ELEMENTS ---
const dom = {
    views: {
        loading: document.getElementById('view-loading'),
        auth: document.getElementById('view-auth'),
        accessDenied: document.getElementById('view-access-denied'),
        main: document.getElementById('view-main'),
        listDetail: document.getElementById('view-list-detail')
    },
    auth: {
        form: document.getElementById('auth-form'),
        email: document.getElementById('auth-email'),
        pass: document.getElementById('auth-password'),
        error: document.getElementById('auth-error'),
        btnSign: document.getElementById('btn-signin'),
        btnCreate: document.getElementById('btn-signup')
    },
    nav: {
        bottom: document.getElementById('bottom-nav'),
        back: document.getElementById('btn-back'),
        menu: document.getElementById('btn-menu'),
        title: document.getElementById('header-title'),
        buttons: document.querySelectorAll('.nav-btn'),
        tabs: {
            home: document.getElementById('tab-home'),
            history: document.getElementById('tab-history'),
            templates: document.getElementById('tab-templates'),
            stores: document.getElementById('tab-stores'),
            settings: document.getElementById('tab-settings')
        }
    },
    home: {
        container: document.getElementById('lists-container'),
        newName: document.getElementById('new-list-name'),
        btnCreate: document.getElementById('btn-create-list')
    },
    list: {
        container: document.getElementById('list-items-container'),
        quickAdd: document.getElementById('quick-add-input'),
        btnAdd: document.getElementById('btn-quick-add'),
        search: document.getElementById('item-search'),
        storeSelect: document.getElementById('list-store-select'),
        sectionSelect: document.getElementById('quick-add-section')
    },
    stores: {
        container: document.getElementById('stores-container'),
        newName: document.getElementById('new-store-name'),
        btnCreate: document.getElementById('btn-create-store'),
        detailView: document.getElementById('view-store-detail'),
        detailName: document.getElementById('store-detail-name'),
        sectionsContainer: document.getElementById('store-sections-container'),
        newSectionInput: document.getElementById('new-section-input'),
        btnAddSection: document.getElementById('btn-add-section')
    },
    settings: {
        email: document.getElementById('settings-email'),
        myUid: document.getElementById('settings-my-uid'),
        allowedList: document.getElementById('allowed-uids-list'),
        inputUid: document.getElementById('new-allowed-uid'),
        btnAdd: document.getElementById('btn-add-uid'),
        uidDisplayDenied: document.getElementById('user-uid-display')
    },
    history: {
        container: document.getElementById('history-container'),
        archivedContainer: document.getElementById('archived-lists-container')
    }
};

// --- AUTH LOGIC ---
onAuthStateChanged(auth, (user) => {
    state.user = user;
    if (user) {
        console.log("User logged in:", user.uid);
        checkAccessAndLoad(user.uid);
    } else {
        console.log("User logged out");
        showView('auth');
        cleanupListeners();
    }
});

dom.auth.form.addEventListener('submit', (e) => {
    e.preventDefault();
    login();
});

dom.auth.btnSign.addEventListener('click', (e) => {
    // handled by form submit if inside form, but explicit click safety
    if (dom.auth.form.checkValidity()) login();
});

dom.auth.btnCreate.addEventListener('click', async () => {
    const email = dom.auth.email.value;
    const pass = dom.auth.pass.value;
    if (!email || !pass) return showError("Please enter email and password.");

    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        // Auth state change will handle the rest
    } catch (e) {
        showError(e.message);
    }
});

async function login() {
    const email = dom.auth.email.value;
    const pass = dom.auth.pass.value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
        showError(e.message);
    }
}

function showError(msg) {
    dom.auth.error.textContent = msg;
    dom.auth.error.classList.remove('hidden');
}

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));
document.getElementById('btn-logout-denied').addEventListener('click', () => signOut(auth));

// --- SECURITY LOGIC ---
function checkAccessAndLoad(uid) {
    // Listen to meta/allowedUsers
    const metaRef = doc(db, 'meta', 'allowedUsers');

    // Unsubscribe previous if any
    if (state.unsubscribeAllowed) state.unsubscribeAllowed();

    state.unsubscribeAllowed = onSnapshot(metaRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            state.allowedUids = data.uids || [];

            if (state.allowedUids.includes(uid)) {
                state.isAllowed = true;
                // If we were in loading/auth/denied, go to main
                if (dom.views.main.classList.contains('hidden')) {
                    initApp();
                }
                updateSettingsUI();
            } else {
                state.isAllowed = false;
                showView('accessDenied');
                dom.settings.uidDisplayDenied.textContent = uid;
            }
        } else {
            console.error("Meta document missing! Please create meta/allowedUsers.");
            showError("System Error: meta/allowedUsers document missing.");
        }
    }, (error) => {
        console.error("Meta access error:", error);
        showView('accessDenied');
        dom.settings.uidDisplayDenied.textContent = uid + " (Check Permissions)";
    });
}

// --- APP LOGIC ---

function initApp() {
    showView('main');
    setupNavigation();
    subscribeLists();
    subscribeHistory();
    subscribeStores();
    renderTemplates();
    setupStoreEvents();
}

function cleanupListeners() {
    if (state.unsubscribeLists) state.unsubscribeLists();
    if (state.unsubscribeItems) state.unsubscribeItems();
    if (state.unsubscribeAllowed) state.unsubscribeAllowed();
    if (state.unsubscribeStores) state.unsubscribeStores();
}

// --- NAVIGATION ---
function showView(viewName) {
    Object.values(dom.views).forEach(el => el.classList.add('hidden'));
    dom.views[viewName].classList.remove('hidden');
    if (viewName === 'main') switchTab('home');
}

function setupNavigation() {
    dom.nav.buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    dom.nav.back.addEventListener('click', () => {
        if (!dom.stores.detailView.classList.contains('hidden')) closeStoreDetail();
        else if (!dom.views.listDetail.classList.contains('hidden')) closeListDetail();
    });

    dom.nav.menu.addEventListener('click', handleMenuAction);
}

function switchTab(tabName) {
    dom.nav.buttons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    Object.values(dom.nav.tabs).forEach(el => el.classList.add('hidden'));
    dom.nav.tabs[tabName].classList.remove('hidden');

    if (tabName === 'home') dom.nav.title.textContent = "Young Lists";
    else if (tabName === 'history') dom.nav.title.textContent = "History";
    else if (tabName === 'templates') dom.nav.title.textContent = "Templates";
    else if (tabName === 'stores') dom.nav.title.textContent = "My Stores";
    else if (tabName === 'settings') dom.nav.title.textContent = "Settings";

    dom.nav.back.classList.add('hidden');
    dom.nav.menu.classList.add('hidden');
}

// --- HOME / LISTS ---

function subscribeLists() {
    const q = query(
        collection(db, 'lists'),
        where('isArchived', '==', false),
        orderBy('updatedAt', 'desc')
    );

    state.unsubscribeLists = onSnapshot(q, (snapshot) => {
        state.lists = [];
        dom.home.container.innerHTML = '';

        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            state.lists.push(data);
            dom.home.container.appendChild(createListCard(data));
        });
    });
}

function createListCard(data) {
    const el = document.createElement('div');
    el.className = 'list-card';
    el.innerHTML = `
        <div class="list-info">
            <span class="list-name">${data.name}</span>
            <span class="list-meta">Tap to open</span> 
        </div>
        <button class="list-actions-btn">…</button>
    `;

    el.addEventListener('click', (e) => {
        if (e.target.classList.contains('list-actions-btn')) {
            e.stopPropagation();
            showListActions(data);
        } else {
            openList(data.id, data.name);
        }
    });

    return el;
}

dom.home.btnCreate.addEventListener('click', async () => {
    const name = dom.home.newName.value.trim();
    if (!name) return;

    try {
        await addDoc(collection(db, 'lists'), {
            name: name,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            isArchived: false,
            archivedAt: null
        });
        dom.home.newName.value = '';
    } catch (e) {
        console.error("Error creating list:", e);
    }
});

function showListActions(listData) {
    const action = prompt(`Actions for "${listData.name}":\nType "archive" or "delete" or "rename"`);

    if (action === 'archive') {
        updateDoc(doc(db, 'lists', listData.id), {
            isArchived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } else if (action === 'delete') {
        if (confirm("Permanently delete this list?")) deleteDoc(doc(db, 'lists', listData.id));
    } else if (action === 'rename') {
        const newName = prompt("New name:", listData.name);
        if (newName) updateDoc(doc(db, 'lists', listData.id), { name: newName, updatedAt: serverTimestamp() });
    }
}

// --- LIST DETAIL VIEW ---

async function openList(listId, listName) {
    state.activeListId = listId;
    dom.nav.title.textContent = listName;
    dom.views.listDetail.classList.remove('hidden');
    dom.nav.back.classList.remove('hidden');
    dom.nav.menu.classList.remove('hidden');

    // Load list doc to get associated store
    const listDoc = await getDoc(doc(db, 'lists', listId));
    const listData = listDoc.exists() ? listDoc.data() : {};
    state.activeListStoreId = listData.storeId || '';

    // Populate store selector
    populateStoreSelect(dom.list.storeSelect, state.activeListStoreId);
    populateSectionSelect();

    const q = query(collection(db, 'lists', listId, 'items'), orderBy('createdAt', 'asc'));
    if (state.unsubscribeItems) state.unsubscribeItems();
    state.unsubscribeItems = onSnapshot(q, (snapshot) => {
        state.currentItemsSnapshot = snapshot;
        renderItems(snapshot);
    });
}

function closeListDetail() {
    state.activeListId = null;
    if (state.unsubscribeItems) state.unsubscribeItems();
    dom.views.listDetail.classList.add('hidden');
    dom.nav.back.classList.add('hidden');
    dom.nav.menu.classList.add('hidden');
    switchTab('home');
}

function renderItems(snapshot) {
    dom.list.container.innerHTML = '';
    const searchTerm = dom.list.search.value.toLowerCase();

    // Collect all items
    const items = [];
    snapshot.forEach(docSnap => {
        const item = docSnap.data();
        item.id = docSnap.id;
        if (searchTerm && !item.text.toLowerCase().includes(searchTerm)) return;
        items.push(item);
    });

    // Get store sections for sorting
    const store = state.stores.find(s => s.id === state.activeListStoreId);

    if (store && store.sections && store.sections.length > 0) {
        // Sort items by store section order
        const sectionOrder = {};
        store.sections.forEach((s, i) => { sectionOrder[s.toLowerCase()] = i; });

        items.sort((a, b) => {
            const aSection = (a.section || '').toLowerCase();
            const bSection = (b.section || '').toLowerCase();
            const aOrder = aSection in sectionOrder ? sectionOrder[aSection] : 9999;
            const bOrder = bSection in sectionOrder ? sectionOrder[bSection] : 9999;
            return aOrder - bOrder;
        });

        // Group by section and render with headers
        let currentSection = null;
        items.forEach(item => {
            const section = item.section || 'Unsorted';
            if (section !== currentSection) {
                currentSection = section;
                const header = document.createElement('div');
                header.className = 'section-header';
                header.textContent = section;
                dom.list.container.appendChild(header);
            }
            dom.list.container.appendChild(createItemRow(item));
        });
    } else {
        // No store — render flat list
        items.forEach(item => {
            dom.list.container.appendChild(createItemRow(item));
        });
    }
}

function createItemRow(item) {
    const row = document.createElement('div');
    row.className = `item-row ${item.checked ? 'item-checked' : ''}`;
    const sectionBadge = item.section ? `<span class="item-section-badge">${item.section}</span>` : '';
    row.innerHTML = `
        <input type="checkbox" class="item-checkbox" ${item.checked ? 'checked' : ''}>
        <div class="item-content">
            <span class="item-text">${item.text}</span>
            ${sectionBadge}
            ${item.note ? `<span class="item-note">${item.note}</span>` : ''}
        </div>
        <button class="item-delete">&times;</button>
    `;

    row.querySelector('.item-checkbox').addEventListener('change', (e) => {
        const checked = e.target.checked;
        updateDoc(doc(db, 'lists', state.activeListId, 'items', item.id), {
            checked: checked,
            checkedAt: checked ? serverTimestamp() : null,
            updatedAt: serverTimestamp()
        });
    });

    row.querySelector('.item-delete').addEventListener('click', () => {
        deleteDoc(doc(db, 'lists', state.activeListId, 'items', item.id));
    });

    return row;
}

dom.list.search.addEventListener('input', () => {
    // Re-render from snapshot to properly filter with section grouping
    if (state.currentItemsSnapshot) renderItems(state.currentItemsSnapshot);
});

dom.list.btnAdd.addEventListener('click', handleQuickAdd);
dom.list.quickAdd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleQuickAdd();
});

async function handleQuickAdd() {
    const raw = dom.list.quickAdd.value;
    if (!raw.trim()) return;

    const section = dom.list.sectionSelect.value || '';

    // Split by comma
    const parts = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const batch = writeBatch(db);
    parts.forEach(text => {
        const newRef = doc(collection(db, 'lists', state.activeListId, 'items'));
        batch.set(newRef, {
            text: text,
            section: section,
            checked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });

    await batch.commit();
    dom.list.quickAdd.value = '';
    dom.list.quickAdd.focus();
}

function handleMenuAction() {
    if (!state.activeListId) return;

    const action = prompt(`Menu:\nType "complete" to finish trip.\nType "rename" to rename list.`);
    if (action === 'complete') {
        completeTrip();
    } else if (action === 'rename') {
        const n = prompt("New Name");
        if (n) updateDoc(doc(db, 'lists', state.activeListId), { name: n });
    }
}

async function completeTrip() {
    if (!confirm("Complete trip? Checked items will be moved to History.")) return;

    try {
        const q = query(
            collection(db, 'lists', state.activeListId, 'items'),
            where('checked', '==', true)
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            alert("No checked items.");
            return;
        }

        // 1. Create History Trip
        const tripRef = await addDoc(collection(db, 'history'), {
            listId: state.activeListId,
            listName: dom.nav.title.textContent,
            completedAt: serverTimestamp(),
            completedBy: state.user.uid,
            itemCount: snapshot.size
        });

        // 2. Batch Move (Write new, Delete old)
        // Note: Batch limit is 500. Assuming small households.
        const batch = writeBatch(db);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Add to history subcollection
            const histItemRef = doc(collection(db, 'history', tripRef.id, 'items'));
            batch.set(histItemRef, {
                text: data.text,
                note: data.note || '',
                checkedAt: data.checkedAt || serverTimestamp()
            });
            // Delete from current list
            batch.delete(doc(db, 'lists', state.activeListId, 'items', docSnap.id));
        });

        await batch.commit();
        alert("Trip completed!");
        closeListDetail(); // Go back home

    } catch (e) {
        console.error("Error completing trip:", e);
        alert("Error: " + e.message);
    }
}

// --- STORE SELECTOR ON LIST ---
dom.list.storeSelect.addEventListener('change', async () => {
    if (!state.activeListId) return;
    const storeId = dom.list.storeSelect.value;
    state.activeListStoreId = storeId;

    await updateDoc(doc(db, 'lists', state.activeListId), {
        storeId: storeId,
        updatedAt: serverTimestamp()
    });

    // Update section dropdown for quick-add
    populateSectionSelect();

    // Re-render items with new sort order
    if (state.currentItemsSnapshot) renderItems(state.currentItemsSnapshot);
});

// --- HISTORY & ARCHIVE ---

function subscribeHistory() {
    const qTrips = query(collection(db, 'history'), orderBy('completedAt', 'desc'));
    onSnapshot(qTrips, (snap) => {
        dom.history.container.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const dateStr = data.completedAt ? new Date(data.completedAt.seconds * 1000).toLocaleDateString() : 'Just now';

            const row = document.createElement('div');
            row.className = 'history-item';
            row.innerHTML = `
                <div>
                    <div class="history-main">${data.listName}</div>
                    <div class="history-sub">${dateStr}</div>
                </div>
                <div>${data.itemCount} items</div>
            `;
            dom.history.container.appendChild(row);
        });
    });

    const qArchived = query(collection(db, 'lists'), where('isArchived', '==', true));
    onSnapshot(qArchived, (snap) => {
        dom.history.archivedContainer.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const el = document.createElement('div');
            el.className = 'list-card';
            el.innerHTML = `<span>${data.name}</span><button class="btn-xs">Restore</button>`;
            el.querySelector('button').addEventListener('click', () => {
                updateDoc(doc(db, 'lists', d.id), { isArchived: false, updatedAt: serverTimestamp() });
            });
            dom.history.archivedContainer.appendChild(el);
        });
    });
}

// --- TEMPLATES ---
function renderTemplates() {
    const templates = [
        { name: "Weekly Staples", items: ["Milk", "Eggs", "Bread", "Bananas"] },
        { name: "Costco Run", items: ["Paper Towels", "Water", "Snacks", "Meat"] },
        { name: "Pharmacy", items: ["Toothpaste", "Soap", "Vitamins"] }
    ];

    dom.nav.tabs.templates.querySelector('#templates-container').innerHTML = '';

    templates.forEach(t => {
        const el = document.createElement('div');
        el.className = 'list-card';
        el.innerHTML = `<span>${t.name}</span> <span class="text-muted">+</span>`;
        el.addEventListener('click', () => {
            applyTemplate(t);
        });
        dom.nav.tabs.templates.querySelector('#templates-container').appendChild(el);
    });
}

function applyTemplate(t) {
    const listName = prompt(`Create new list from "${t.name}"? Enter name:`, t.name);
    if (!listName) return;

    addDoc(collection(db, 'lists'), {
        name: listName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isArchived: false
    }).then(ref => {
        const batch = writeBatch(db);
        t.items.forEach(item => {
            const r = doc(collection(db, 'lists', ref.id, 'items'));
            batch.set(r, { text: item, checked: false, createdAt: serverTimestamp() });
        });
        batch.commit();
        alert("List created!");
        switchTab('home');
    });
}

// --- STORES ---

function subscribeStores() {
    const q = query(collection(db, 'stores'), orderBy('createdAt', 'asc'));
    if (state.unsubscribeStores) state.unsubscribeStores();

    state.unsubscribeStores = onSnapshot(q, (snapshot) => {
        state.stores = [];
        dom.stores.container.innerHTML = '';

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            state.stores.push(data);
            dom.stores.container.appendChild(createStoreCard(data));
        });
    });
}

function setupStoreEvents() {
    dom.stores.btnCreate.addEventListener('click', async () => {
        const name = dom.stores.newName.value.trim();
        if (!name) return;

        await addDoc(collection(db, 'stores'), {
            name: name,
            sections: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        dom.stores.newName.value = '';
    });

    dom.stores.btnAddSection.addEventListener('click', handleAddSection);
    dom.stores.newSectionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddSection();
    });
}

function createStoreCard(data) {
    const el = document.createElement('div');
    el.className = 'list-card';
    const sectionCount = (data.sections || []).length;
    const sectionPreview = (data.sections || []).slice(0, 4).join(' > ');
    el.innerHTML = `
        <div class="list-info">
            <span class="list-name">${data.name}</span>
            <span class="store-card-sections">${sectionCount} sections${sectionPreview ? ': ' + sectionPreview + (sectionCount > 4 ? '...' : '') : ''}</span>
        </div>
        <button class="list-actions-btn">...</button>
    `;

    el.addEventListener('click', (e) => {
        if (e.target.classList.contains('list-actions-btn')) {
            e.stopPropagation();
            showStoreActions(data);
        } else {
            openStoreDetail(data.id, data.name);
        }
    });

    return el;
}

function showStoreActions(storeData) {
    const action = prompt(`Actions for "${storeData.name}":\nType "delete" or "rename"`);
    if (action === 'delete') {
        if (confirm("Delete this store layout?")) deleteDoc(doc(db, 'stores', storeData.id));
    } else if (action === 'rename') {
        const newName = prompt("New name:", storeData.name);
        if (newName) updateDoc(doc(db, 'stores', storeData.id), { name: newName, updatedAt: serverTimestamp() });
    }
}

function openStoreDetail(storeId, storeName) {
    state.activeStoreId = storeId;
    dom.stores.detailName.textContent = storeName;
    dom.stores.detailView.classList.remove('hidden');
    dom.nav.back.classList.remove('hidden');
    dom.nav.title.textContent = storeName;

    renderStoreSections();
}

function closeStoreDetail() {
    state.activeStoreId = null;
    dom.stores.detailView.classList.add('hidden');
    dom.nav.back.classList.add('hidden');
    switchTab('stores');
}

function renderStoreSections() {
    const store = state.stores.find(s => s.id === state.activeStoreId);
    if (!store) return;

    dom.stores.sectionsContainer.innerHTML = '';
    const sections = store.sections || [];

    sections.forEach((section, index) => {
        const row = document.createElement('div');
        row.className = 'section-row';
        row.innerHTML = `
            <span class="section-order">${index + 1}</span>
            <span class="section-name">${section}</span>
            <div class="section-actions">
                <button class="btn-move-up" title="Move up" ${index === 0 ? 'disabled' : ''}>&#9650;</button>
                <button class="btn-move-down" title="Move down" ${index === sections.length - 1 ? 'disabled' : ''}>&#9660;</button>
                <button class="btn-section-delete" title="Remove">&times;</button>
            </div>
        `;

        row.querySelector('.btn-move-up').addEventListener('click', () => moveSectionUp(index));
        row.querySelector('.btn-move-down').addEventListener('click', () => moveSectionDown(index));
        row.querySelector('.btn-section-delete').addEventListener('click', () => deleteSection(index));

        dom.stores.sectionsContainer.appendChild(row);
    });
}

async function handleAddSection() {
    const name = dom.stores.newSectionInput.value.trim();
    if (!name || !state.activeStoreId) return;

    const store = state.stores.find(s => s.id === state.activeStoreId);
    if (!store) return;

    const sections = [...(store.sections || []), name];
    await updateDoc(doc(db, 'stores', state.activeStoreId), {
        sections: sections,
        updatedAt: serverTimestamp()
    });

    dom.stores.newSectionInput.value = '';
    dom.stores.newSectionInput.focus();

    // Update local state and re-render
    store.sections = sections;
    renderStoreSections();
}

async function moveSectionUp(index) {
    if (index === 0) return;
    const store = state.stores.find(s => s.id === state.activeStoreId);
    if (!store) return;

    const sections = [...store.sections];
    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];

    await updateDoc(doc(db, 'stores', state.activeStoreId), { sections, updatedAt: serverTimestamp() });
    store.sections = sections;
    renderStoreSections();
}

async function moveSectionDown(index) {
    const store = state.stores.find(s => s.id === state.activeStoreId);
    if (!store || index >= store.sections.length - 1) return;

    const sections = [...store.sections];
    [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];

    await updateDoc(doc(db, 'stores', state.activeStoreId), { sections, updatedAt: serverTimestamp() });
    store.sections = sections;
    renderStoreSections();
}

async function deleteSection(index) {
    const store = state.stores.find(s => s.id === state.activeStoreId);
    if (!store) return;

    const sections = store.sections.filter((_, i) => i !== index);
    await updateDoc(doc(db, 'stores', state.activeStoreId), { sections, updatedAt: serverTimestamp() });
    store.sections = sections;
    renderStoreSections();
}

// --- STORE/SECTION HELPERS ---

function populateStoreSelect(selectEl, selectedId) {
    selectEl.innerHTML = '<option value="">No store (default order)</option>';
    state.stores.forEach(store => {
        const opt = document.createElement('option');
        opt.value = store.id;
        opt.textContent = store.name;
        if (store.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

function populateSectionSelect() {
    const select = dom.list.sectionSelect;
    select.innerHTML = '<option value="">No section</option>';

    const store = state.stores.find(s => s.id === state.activeListStoreId);
    if (store && store.sections) {
        store.sections.forEach(section => {
            const opt = document.createElement('option');
            opt.value = section;
            opt.textContent = section;
            select.appendChild(opt);
        });
    }
}

// --- SETTINGS ---
function updateSettingsUI() {
    if (!state.user) return;
    dom.settings.email.textContent = state.user.email;
    dom.settings.myUid.textContent = state.user.uid;
    dom.settings.myUid.style.fontSize = "0.7rem";

    document.getElementById('btn-copy-uid').addEventListener('click', () => {
        navigator.clipboard.writeText(state.user.uid);
        alert("UID Copied");
    });

    dom.settings.allowedList.innerHTML = '';
    state.allowedUids.forEach(uid => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${uid.slice(0, 8)}...</span>
            <button class="btn-xs text-danger">Remove</button>
        `;
        li.querySelector('button').addEventListener('click', () => {
            if (confirm("Remove this user?")) {
                const newList = state.allowedUids.filter(u => u !== uid);
                updateDoc(doc(db, 'meta', 'allowedUsers'), { uids: newList });
            }
        });
        dom.settings.allowedList.appendChild(li);
    });

    dom.settings.btnAdd.onclick = () => {
        const val = dom.settings.inputUid.value.trim();
        if (val) {
            const newList = [...state.allowedUids, val];
            updateDoc(doc(db, 'meta', 'allowedUsers'), { uids: newList });
            dom.settings.inputUid.value = '';
        }
    };

    document.getElementById('btn-check-update').addEventListener('click', () => {
        // Force refresh for update
        window.location.reload();
    });
}
