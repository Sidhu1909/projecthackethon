// firebase helper for candlogin.html
// integrates firebase auth with the voice-based candidate login flow.
// handles sign-in attempts, role persistence, and redirects on success.

import {
  onAuthChange,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  resetPassword,
} from './index.js';

// expose a function that the HTML can call to attempt firebase sign-in
// with the spoken credentials. this replaces the dummy credential check.
export async function attemptFirebaseSignIn(spokenEmail, spokenPassword) {
  try {
    // normalize inputs (remove spaces, handle common speech errors)
    const email = spokenEmail.toLowerCase().replace(/\s+/g, '').replace(/at/g, '@').replace(/dot/g, '.');
    const password = spokenPassword.trim();

    // basic validation
    if (!email.includes('@') || password.length < 6) {
      return { success: false, error: 'Invalid email or password format' };
    }

    // attempt firebase sign-in
    const result = await signInWithEmail(email, password);

    if (result.error) {
      return { success: false, error: result.error };
    }

    // success: persist role and return user
    localStorage.setItem('titanRole', 'candidate');
    return { success: true, user: result.user };

  } catch (err) {
    console.error('firebase sign-in error:', err);
    return { success: false, error: err.message || 'Sign-in failed' };
  }
}

// monitor auth state and redirect logged-in candidates to their dashboard
export function setupCandidateAuthRedirect() {
  onAuthChange(user => {
    if (!user || !user.isLoggedIn) return;
    const role = localStorage.getItem('titanRole');
    if (role === 'candidate') {
      // redirect to candidate dashboard (create this file if needed)
      window.location.href = './candidate-dashboard.html';
    }
  });
}

// optional: helper for google sign-in if you want to add a button later
export async function handleGoogleSignIn() {
  try {
    const result = await signInWithGoogle();
    if (result.error) {
      return { success: false, error: result.error };
    }
    localStorage.setItem('titanRole', 'candidate');
    return { success: true, user: result.user };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// expose to global scope for HTML access
window.attemptFirebaseSignIn = attemptFirebaseSignIn;
window.handleGoogleSignIn = handleGoogleSignIn;
setupCandidateAuthRedirect();
