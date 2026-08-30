// =============================================================================
// Settings: account, household membership, invites, app info
// =============================================================================
// This screen replaces the old "Allowed UIDs" panel, which asked people to copy
// a 28-character Firebase UID between devices and then tried to write it to a
// document the published security rules forbade the client from writing. Adding
// somebody now means generating a code they type once.
//
// Every listener in here is attached exactly once, from initSettingsUi(). The
// render functions only ever replace content — they never call addEventListener
// on a shared element, which is how the previous version ended up firing one
// click several times after a few database updates.
// =============================================================================

import { friendlyError, APP_VERSION } from './supabase.js';
import * as data from './data.js';
import {
  $, el, render, toast, toastError, confirmDialog, formatDate
} from './ui.js';
import { signOut } from './auth.js';

let realtimeStatus = 'connecting…';

export function renderSettings() {
  $('settings-email').textContent = data.state.user?.email || '';
  $('settings-version').textContent = APP_VERSION;
  $('settings-realtime').textContent = realtimeStatus;

  const household = data.state.household;
  $('settings-household').textContent = household
    ? `${household.name} · you are ${household.role === 'owner' ? 'the owner' : 'a member'}`
    : 'No household';

  renderMembers();
  renderInviteArea();
}

export function setRealtimeStatus(status) {
  realtimeStatus = status;
  const node = $('settings-realtime');
  if (node) node.textContent = status;
}

function renderMembers() {
  const list = $('members-list');
  const me = data.state.user?.id;

  render(list, data.state.members.map((member) => {
    const isMe = member.user_id === me;
    return el('li', { className: 'member-row' }, [
      el('div', { className: 'member-info' }, [
        el('span', {
          className: 'member-name',
          // Supabase does not expose other users' email addresses to the client
          // (by design), so members other than you are shown by role and join
          // date rather than by a leaked address.
          text: isMe ? (data.state.user.email || 'You') : `Household ${member.role}`
        }),
        el('span', {
          className: 'member-meta',
          text: `${member.role === 'owner' ? 'Owner' : 'Member'} · joined ${formatDate(member.created_at)}`
        })
      ]),
      canRemove(member) && el('button', {
        className: 'btn btn-outline btn-xs btn-danger-text', type: 'button',
        text: isMe ? 'Leave' : 'Remove',
        on: { click: () => removeMember(member, isMe) }
      })
    ]);
  }));
}

function canRemove(member) {
  const isOwner = data.state.household?.role === 'owner';
  const isMe = member.user_id === data.state.user?.id;
  // The database refuses to strand a household without an owner; the UI just
  // avoids offering a button that would always fail.
  if (isMe) return !(member.role === 'owner' && ownerCount() === 1);
  return isOwner;
}

function ownerCount() {
  return data.state.members.filter((m) => m.role === 'owner').length;
}

async function removeMember(member, isMe) {
  const ok = await confirmDialog({
    title: isMe ? 'Leave this household?' : 'Remove this member?',
    message: isMe
      ? 'You will lose access to its lists until somebody invites you back.'
      : 'They lose access to the household immediately. Nothing already on the lists is deleted.',
    confirmLabel: isMe ? 'Leave' : 'Remove', danger: true
  });
  if (!ok) return;

  const { error } = await data.removeMember(member.user_id);
  if (error) return toastError(friendlyError(error, 'Could not update the household.'));

  if (isMe) {
    await signOut();
    return;
  }
  await data.loadMembers();
  renderSettings();
  toast('Member removed.');
}

// -----------------------------------------------------------------------------
// Invites
// -----------------------------------------------------------------------------
function renderInviteArea() {
  const host = $('invite-area');
  if (data.state.household?.role !== 'owner') {
    return render(host, el('p', {
      className: 'text-small text-muted',
      text: 'Ask the household owner if somebody else needs to be added.'
    }));
  }

  render(host, [
    el('p', {
      className: 'text-small text-muted',
      text: 'To add the other person: they create their own account, then enter this code on their "Join with a code" screen. It is good for one use and expires in 7 days.'
    }),
    el('button', {
      className: 'btn btn-outline btn-full', type: 'button', id: 'btn-create-invite',
      text: 'Create an invite code',
      on: { click: createInvite }
    })
  ]);
}

async function createInvite() {
  const button = $('btn-create-invite');
  button.disabled = true;
  const { data: code, error } = await data.createInvite(168);
  button.disabled = false;

  if (error) return toastError(friendlyError(error, 'Could not create an invite code.'));

  render($('invite-area'), [
    el('p', { className: 'text-small text-muted', text: 'Give this code to the other person. One use, expires in 7 days.' }),
    el('div', { className: 'code-box', text: code }),
    el('button', {
      className: 'btn btn-outline btn-full', type: 'button', text: 'Copy code',
      on: {
        click: async () => {
          try {
            await navigator.clipboard.writeText(code);
            toast('Code copied.');
          } catch {
            toast('Copy did not work — read the code out instead.');
          }
        }
      }
    }),
    el('button', {
      className: 'btn btn-outline btn-full mt-small', type: 'button', text: 'Done',
      on: { click: renderInviteArea }
    })
  ]);
}

// -----------------------------------------------------------------------------
// One-time wiring
// -----------------------------------------------------------------------------
export function initSettingsUi() {
  $('btn-logout').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Sign out?', confirmLabel: 'Sign out'
    });
    if (ok) await signOut();
  });

  $('btn-check-update').addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) await registration.update();
    }
    toast('Checked. Reloading to pick up any new version…');
    setTimeout(() => window.location.reload(), 800);
  });

  data.on('members', renderSettings);
  data.on('household', renderSettings);
}
