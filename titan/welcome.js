// firebase helper for welcome.html
// imports firebase utilities defined in index.js and wires up a couple of
// simple helpers that the voice-entry page can use.

import {
  onAuthChange,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  resetPassword,
} from './index.js';

export function setupFirebaseRedirect() {
  onAuthChange(user => {
    if (!user || !user.isLoggedIn) return;
    const role = localStorage.getItem('titanRole');
    if (role === 'recruiter') {
      // if already logged in and landing on welcome, send to login page which
      // itself will forward to dashboard when the auth listener fires there.
      window.location.href = './recruiterlogin.html';
    } else if (role === 'candidate') {
      // nothing; candidate stays on entry page
    }
  });
}

// when the voice flow decides which portal to open we persist the choice
// and (optionally) trigger a firebase sign-in flow if desired. the page can
// call this helper instead of the built-in redirectTo().
export async function openPortal(type) {
  // remember what role the user selected
  localStorage.setItem('titanRole', type);

  // recruiters should always go through the login screen first
  if (type === 'recruiter') {
    // optionally pre-trigger a Google sign-in attempt in the background
    try {
      const res = await signInWithGoogle();
      if (res.error) console.warn('google sign-in failed:', res.error);
    } catch (err) {
      console.warn('firebase error on recruiter open', err);
    }

    window.location.href = './recruiterlogin.html';
    return;
  }

  // candidates are handled by welcome.html itself; do not navigate away here
  // (could redirect to a real dashboard if added later)
}

// expose smaller helpers for debugging or manual use
window.openPortal = openPortal;
setupFirebaseRedirect();