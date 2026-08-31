// =============================================================================
// Young Lists — Supabase connection settings
// =============================================================================
// Fill these in once, commit them, and every deployment (GitHub Pages, Netlify,
// Vercel, a local file server) uses the same values.
//
// Where to find them:
//   Supabase dashboard -> your project -> Project Settings -> API
//     * "Project URL"          -> SUPABASE_URL
//     * "Publishable key"      -> SUPABASE_PUBLISHABLE_KEY
//       (older projects call this the "anon public" key; either works)
//
// -----------------------------------------------------------------------------
// The publishable key is MEANT to be visible in the browser.
// It identifies the project; it does not grant access. All access is decided by
// Supabase Auth plus the Row Level Security policies in supabase/migrations/.
//
// NEVER put any of these in this file, or anywhere else under young-lists/:
//   * the secret key / `service_role` key   (bypasses every RLS policy)
//   * the database password
//   * a JWT secret or any server credential
// Anything in this directory is served to the public web verbatim.
// -----------------------------------------------------------------------------

export const SUPABASE_URL = "";
export const SUPABASE_PUBLISHABLE_KEY = "";

// Shown in Settings and used to tell users which build they are running.
export const APP_VERSION = "2.0.0";
