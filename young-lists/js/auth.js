// =============================================================================
// Authentication and household onboarding
// =============================================================================
// Every person has their own Supabase Auth account. There is no shared password
// and no list of "allowed UIDs" pasted in by hand — access comes from being a
// row in household_members, which the database checks on every query.
// =============================================================================

import { supabase, friendlyError } from './supabase.js';
import { $, show, toast, toastError } from './ui.js';
import * as data from './data.js';

let busy = false;

/** Disable both buttons while a request is in flight, so a double-tap is a no-op. */
function setBusy(value) {
  busy = value;
  $('btn-signin').disabled = value;
  $('btn-signup').disabled = value;
  $('btn-signin').textContent = value ? 'Signing in…' : 'Sign in';
}

function showAuthError(message) {
  const node = $('auth-error');
  node.textContent = message;
  show(node, true);
}

function clearAuthError() {
  show($('auth-error'), false);
}

function credentials() {
  return {
    email: $('auth-email').value.trim(),
    password: $('auth-password').value
  };
}

async function signIn() {
  if (busy) return;
  const { email, password } = credentials();
  if (!email || !password) return showAuthError('Enter your email and password.');

  clearAuthError();
  setBusy(true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setBusy(false);
  if (error) showAuthError(friendlyError(error, 'Could not sign in.'));
  // Success is handled by the onAuthStateChange listener in app.js.
}

async function signUp() {
  if (busy) return;
  const { email, password } = credentials();
  if (!email || !password) return showAuthError('Enter an email and a password.');
  if (password.length < 6) return showAuthError('Choose a password of at least 6 characters.');

  clearAuthError();
  setBusy(true);
  const { data: result, error } = await supabase.auth.signUp({ email, password });
  setBusy(false);

  if (error) return showAuthError(friendlyError(error, 'Could not create the account.'));
  if (result.user && !result.session) {
    // The project has email confirmation switched on.
    showAuthError('Account created. Check your email to confirm the address, then sign in.');
  }
}

export function signOut() {
  return supabase.auth.signOut();
}

/**
 * Wire the auth and onboarding screens. Called exactly once at start-up — this
 * is why nothing here re-registers listeners the way the old Settings screen did
 * on every database update.
 */
export function initAuthUi() {
  // The Sign in button is the form's submit button, so a click already fires
  // `submit`. Only the form listener calls signIn(), which is what stops the
  // same tap from sending two sign-in requests.
  $('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    signIn();
  });
  $('btn-signup').addEventListener('click', signUp);

  for (const id of ['auth-email', 'auth-password']) {
    $(id).addEventListener('input', clearAuthError);
  }

  $('btn-logout-onboarding').addEventListener('click', signOut);
  $('btn-create-household').addEventListener('click', createHousehold);
  $('btn-join-household').addEventListener('click', joinHousehold);

  $('onboard-household-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createHousehold();
  });
  $('onboard-join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinHousehold();
  });
  $('onboard-join-code').addEventListener('input', (event) => {
    // Codes are printed in upper case; accept any casing.
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
}

async function createHousehold() {
  const input = $('onboard-household-name');
  const name = input.value.trim();
  if (!name) return toastError('Give the household a name first.');

  const button = $('btn-create-household');
  button.disabled = true;
  const { error } = await data.createHousehold(name);
  button.disabled = false;

  if (error) return toastError(friendlyError(error, 'Could not create the household.'));
  input.value = '';
  toast('Household created — you are the owner.', { tone: 'success' });
  document.dispatchEvent(new CustomEvent('household-changed'));
}

async function joinHousehold() {
  const input = $('onboard-join-code');
  const code = input.value.trim();
  if (code.length !== 8) return toastError('Invite codes are 8 characters long.');

  const button = $('btn-join-household');
  button.disabled = true;
  const { error } = await data.joinHousehold(code);
  button.disabled = false;

  if (error) return toastError(friendlyError(error, 'Could not join that household.'));
  input.value = '';
  toast('Joined. Welcome!', { tone: 'success' });
  document.dispatchEvent(new CustomEvent('household-changed'));
}
