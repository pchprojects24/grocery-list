// =============================================================================
// Supabase client + error translation
// =============================================================================
// The library itself is loaded by a plain <script> tag in index.html (see
// vendor/README.md for why it is vendored rather than pulled from a CDN); the
// UMD bundle assigns `window.supabase`.
// =============================================================================

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_VERSION } from '../config.js';

export { APP_VERSION };

export const isConfigured = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY &&
  SUPABASE_URL.startsWith('https://')
);

export const supabase = isConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        // Keeps the session in localStorage and refreshes it in the background,
        // so the app does not ask for a password every time it is opened from
        // the home screen.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'young-lists-auth'
      },
      realtime: {
        // Plenty for two phones; keeps us well inside the free tier.
        params: { eventsPerSecond: 5 }
      }
    })
  : null;

// -----------------------------------------------------------------------------
// Error translation.
//
// Users get a sentence they can act on; the raw error goes to the console for
// debugging. Postgres error codes and constraint names are deliberately not
// shown in the UI.
// -----------------------------------------------------------------------------
const MESSAGES = {
  // Supabase Auth
  invalid_credentials: 'That email and password do not match an account.',
  email_not_confirmed: 'Check your email and confirm your address before signing in.',
  user_already_exists: 'An account with that email already exists — try signing in.',
  weak_password: 'Please choose a longer password (at least 6 characters).',
  over_email_send_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  same_password: 'That is already your password.',
  // PostgreSQL / PostgREST
  '42501': 'You do not have permission to do that.',
  '23505': 'That already exists.',
  '23503': 'That refers to something that no longer exists — try reloading.',
  '23514': 'That value is not allowed.',
  'PGRST301': 'Your session has expired. Please sign in again.'
};

/**
 * Turn any error from supabase-js into a short sentence for the UI.
 * @param {unknown} error
 * @param {string} fallback shown when nothing more specific is known
 */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  // Never log credentials — only the shape of the failure.
  console.error('[young-lists]', error.code || error.name || 'error', error.message || error);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Changes cannot be saved until you reconnect.';
  }

  const code = error.code || error.status;
  if (code && MESSAGES[code]) return MESSAGES[code];

  const message = String(error.message || '');
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (/JWT|token is expired|session/i.test(message)) {
    return 'Your session has expired. Please sign in again.';
  }
  if (message === 'NO_CHECKED_ITEMS') {
    return 'Nothing is ticked off yet, so there is no trip to finish.';
  }
  // A few application errors are raised with text meant for people.
  if (/^That invite code is not valid$/.test(message)) return message;
  if (/^A household must keep at least one owner$/.test(message)) return message;
  if (/^Only a household owner/.test(message)) return message;
  if (/household_id is immutable/.test(message)) {
    return 'That item belongs to a different household.';
  }
  return fallback;
}
