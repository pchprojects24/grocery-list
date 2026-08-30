// =============================================================================
// Young Lists — application entry point
// =============================================================================
// Responsibilities, and nothing else:
//   * decide which top-level screen to show (setup / auth / onboarding / main),
//   * wire the navigation bar and the hardware-ish back button,
//   * wire every module's listeners exactly once,
//   * start and stop the realtime subscription as the session changes.
//
// The "exactly once" part matters. In the Firebase version the Settings screen
// re-ran addEventListener every time the database pushed an update, so after a
// few syncs a single tap fired the same handler several times. Here all wiring
// happens in this file's boot() and each module's init*() function, both of
// which run once per page load.
// =============================================================================

import { supabase, isConfigured, friendlyError } from './supabase.js';
import * as data from './data.js';
import { $, show, showView, switchTab, closeOverlay, toast, toastError } from './ui.js';
import { initAuthUi } from './auth.js';
import { initListsUi, renderHome } from './lists.js';
import { initStoresUi, renderStores } from './stores.js';
import { initHistoryUi, renderHistory } from './history.js';
import { initSettingsUi, renderSettings, setRealtimeStatus } from './settings.js';

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
function boot() {
  if (!isConfigured) {
    showView('setup');
    return;
  }

  initAuthUi();
  initListsUi();
  initStoresUi();
  initHistoryUi();
  initSettingsUi();
  initNavigation();
  initConnectivity();

  data.onSyncError((error) => {
    toastError(friendlyError(error, 'Lost track of the latest changes. Pull down to reload if this persists.'));
  });

  data.onRealtimeStatus((status) => {
    const label = {
      SUBSCRIBED: 'connected',
      TIMED_OUT: 'reconnecting…',
      CLOSED: 'disconnected',
      CHANNEL_ERROR: 'disconnected'
    }[status] || String(status).toLowerCase();
    setRealtimeStatus(label);
  });

  // A household was created or joined on the onboarding screen.
  document.addEventListener('household-changed', () => { enterApp().catch(reportFatal); });

  supabase.auth.onAuthStateChange((event, session) => {
    // Fires on sign-in, sign-out, token refresh and tab focus. Only act on the
    // transitions that change which data we should be looking at.
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    handleSession(session).catch(reportFatal);
  });

  supabase.auth.getSession()
    .then(({ data: result }) => handleSession(result.session))
    .catch(reportFatal);
}

function reportFatal(error) {
  console.error('[young-lists]', error);
  showView('auth');
  toastError(friendlyError(error, 'Could not start the app. Please try again.'));
}

async function handleSession(session) {
  if (!session?.user) {
    await data.unsubscribeRealtime();
    data.state.user = null;
    data.state.household = null;
    showView('auth');
    return;
  }

  if (data.state.user?.id === session.user.id && data.state.household) {
    return;                       // already signed in and loaded; nothing to do
  }

  data.state.user = session.user;
  showView('loading');
  await enterApp();
}

async function enterApp() {
  try {
    const household = await data.loadHousehold();
    if (!household) {
      await data.unsubscribeRealtime();
      showView('onboarding');
      return;
    }

    await data.loadAll();
    await data.subscribeRealtime();

    showView('main');
    switchTab('home');
    renderHome();
    renderStores();
    renderHistory();
    renderSettings();
  } catch (error) {
    reportFatal(error);
  }
}

// -----------------------------------------------------------------------------
// Navigation
// -----------------------------------------------------------------------------
function initNavigation() {
  for (const button of document.querySelectorAll('.nav-btn')) {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  }

  $('btn-back').addEventListener('click', () => closeOverlay());

  // Android hardware back / browser back closes an overlay before leaving.
  history.replaceState({ depth: 0 }, '');
  window.addEventListener('popstate', () => {
    if (!closeOverlay()) return;
    history.pushState({ depth: 0 }, '');
  });
}

// -----------------------------------------------------------------------------
// Connectivity
//
// The app shell is cached, so it opens without a connection — but the data is
// not, and there is no write queue. Rather than pretend otherwise, we say so.
// -----------------------------------------------------------------------------
function initConnectivity() {
  const banner = $('offline-banner');

  const update = async (online) => {
    data.state.online = online;
    show(banner, !online);
    if (online && data.state.household) {
      // Catch up on anything missed while the socket was down.
      try {
        await data.loadAll();
        if (data.state.activeList) await data.loadItems();
        await data.subscribeRealtime();
        toast('Back online — lists are up to date.', { tone: 'success' });
      } catch (error) {
        toastError(friendlyError(error, 'Could not refresh after reconnecting.'));
      }
    }
  };

  window.addEventListener('online', () => update(true));
  window.addEventListener('offline', () => update(false));
  show(banner, !navigator.onLine);
}

boot();
