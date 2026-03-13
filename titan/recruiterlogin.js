// ── firebase.js ───────────────────────────────────────────────────────────────
// Shared Firebase module for TalentBridge recruiter portal.
// Imported by recruiterlogin.html via:
//   import { signUpWithEmail, signInWithEmail, ... } from "./firebase.js"
//
// Exports:
//   signUpWithEmail        — create a new recruiter account
//   signInWithEmail        — sign in with email + password
//   signInWithGoogle       — OAuth popup sign-in
//   resetPassword          — send password reset email
//   onAuthChange           — listen for auth state changes
//   updateUserEmail        — change the signed-in user's email (re-auth required)
//   updateUserPassword     — change the signed-in user's password (re-auth required)
//   updateRecruiterProfile — update name/company on existing Firestore doc
//   saveRecruiterProfile   — create/merge a full recruiter profile doc
//   getCurrentRecruiterProfile — read the signed-in recruiter's Firestore doc
//
// Firebase SDK: 11.6.0  (matches recruit.js, candlogin.js, candidate-voice.js)
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ─── Firebase config ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyD3c6gMQt00siR70-B93qBjVqYQAjrM3W4",
  authDomain:        "titan-fde30.firebaseapp.com",
  projectId:         "titan-fde30",
  storageBucket:     "titan-fde30.firebasestorage.app",
  messagingSenderId: "545954155049",
  appId:             "1:545954155049:web:59e785904b07cda5a4ea38",
  measurementId:     "G-4MDFGCVS5H",
};
// ─────────────────────────────────────────────────────────────────────────────

// Use the default app instance (recruit.js and recruiterlogin.html share this)
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Helper: build a consistent return shape ───────────────────────────────────
function ok(user)  { return { user, error: null }; }
function err(e)    { return { user: null, error: e?.message || String(e) }; }

// ── Helper: normalise Firebase error codes into readable messages ──────────────
function fmtError(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use'))   return 'This email is already registered.';
  if (code.includes('invalid-email'))           return 'Please enter a valid email address.';
  if (code.includes('wrong-password') ||
      code.includes('invalid-credential'))      return 'Incorrect email or password.';
  if (code.includes('user-not-found'))          return 'No account found with this email.';
  if (code.includes('weak-password'))           return 'Password must be at least 6 characters.';
  if (code.includes('popup-closed-by-user'))    return 'Google sign-in was cancelled.';
  if (code.includes('too-many-requests'))       return 'Too many attempts. Please wait a moment.';
  if (code.includes('requires-recent-login'))   return 'Please sign in again before making this change.';
  if (code.includes('email-already-in-use'))    return 'That email is already in use.';
  return e?.message || 'An unexpected error occurred.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — SIGN UP
// Creates a Firebase Auth account and writes the recruiter profile to Firestore.
// Firestore path: recruiters/{uid}
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new recruiter account with email + password.
 * Does NOT write the Firestore profile — the login page calls
 * saveRecruiterProfile() separately so it can include name/company.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: FirebaseUser|null, error: string|null }>}
 */
export async function signUpWithEmail(email, password) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return ok(credential.user);
  } catch (e) {
    console.error('[firebase.js] signUpWithEmail:', e.code, e.message);
    return { user: null, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — SIGN IN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sign in an existing recruiter with email + password.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: FirebaseUser|null, error: string|null }>}
 */
export async function signInWithEmail(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return ok(credential.user);
  } catch (e) {
    console.error('[firebase.js] signInWithEmail:', e.code, e.message);
    return { user: null, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — GOOGLE SIGN-IN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Open a Google OAuth popup and sign in.
 * Also creates/merges a minimal Firestore recruiter profile if first sign-in.
 *
 * @returns {Promise<{ user: FirebaseUser|null, error: string|null }>}
 */
export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(auth, provider);
    const user       = credential.user;

    // Ensure a Firestore doc exists for this recruiter
    const ref  = doc(db, 'recruiters', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email:     user.email     || '',
        name:      user.displayName || '',
        photoURL:  user.photoURL  || '',
        role:      'recruiter',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    return ok(user);
  } catch (e) {
    console.error('[firebase.js] signInWithGoogle:', e.code, e.message);
    return { user: null, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — PASSWORD RESET
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a password-reset email.
 *
 * @param {string} email
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true, error: null };
  } catch (e) {
    console.error('[firebase.js] resetPassword:', e.code, e.message);
    return { success: false, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — STATE LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to Firebase Auth state changes.
 * Calls `callback` with { isLoggedIn: bool, user: FirebaseUser|null }.
 *
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback({ isLoggedIn: !!user, user: user || null });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — SIGN OUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sign the current user out.
 *
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function logOut() {
  try {
    await signOut(auth);
    return { success: true, error: null };
  } catch (e) {
    return { success: false, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — UPDATE EMAIL  (requires re-authentication)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update the signed-in user's email address.
 * Re-authenticates with their current password first (Firebase security requirement).
 *
 * @param {string} newEmail
 * @param {string} currentPassword
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function updateUserEmail(newEmail, currentPassword) {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'No user signed in.' };

  try {
    // Re-authenticate before sensitive operation
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updateEmail(user, newEmail);
    return { success: true, error: null };
  } catch (e) {
    console.error('[firebase.js] updateUserEmail:', e.code, e.message);
    return { success: false, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — UPDATE PASSWORD  (requires re-authentication)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update the signed-in user's password.
 * Re-authenticates with their current password first.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function updateUserPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'No user signed in.' };

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    return { success: true, error: null };
  } catch (e) {
    console.error('[firebase.js] updateUserPassword:', e.code, e.message);
    return { success: false, error: fmtError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIRESTORE — RECRUITER PROFILE
// Collection: recruiters/{uid}
// Fields: email, name, company, role, createdAt, updatedAt
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create or merge a full recruiter profile document.
 * Called after signUpWithEmail() so name + company are stored immediately.
 *
 * @param {string} uid
 * @param {{ name: string, company: string, email: string, role?: string }} profile
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function saveRecruiterProfile(uid, { name, company, email, role = 'recruiter' }) {
  try {
    await setDoc(
      doc(db, 'recruiters', uid),
      {
        name,
        company,
        email,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { success: true, error: null };
  } catch (e) {
    console.error('[firebase.js] saveRecruiterProfile:', e.code, e.message);
    return { success: false, error: fmtError(e) };
  }
}

/**
 * Update name and/or company on an existing recruiter profile.
 * Uses the currently signed-in user's UID.
 *
 * @param {{ name?: string, company?: string }} updates
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function updateRecruiterProfile(updates) {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'No user signed in.' };

  try {
    await updateDoc(doc(db, 'recruiters', user.uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    // Mirror to localStorage for quick access across pages
    if (updates.name)    localStorage.setItem('titanName',    updates.name);
    if (updates.company) localStorage.setItem('titanCompany', updates.company);
    return { success: true, error: null };
  } catch (e) {
    console.error('[firebase.js] updateRecruiterProfile:', e.code, e.message);
    return { success: false, error: fmtError(e) };
  }
}
onAuthChange((state) => {
  if (isRedirecting()) return;

  if (!_authSettled) {
    _authSettled = true;

    if (!state.isLoggedIn) {
      return;
    }

    localStorage.setItem('titanRole', 'recruiter');

    if (state.user?.displayName) {
      localStorage.setItem('titanName', state.user.displayName);
    }

    redirectToDashboard();
    return;
  }

  if (!state.isLoggedIn) return;

  localStorage.setItem('titanRole', 'recruiter');

  if (state.user?.displayName) {
    localStorage.setItem('titanName', state.user.displayName);
  }

  redirectToDashboard();
});
setTimeout(redirectToDashboard, 1400);
/**
 * Read the currently signed-in recruiter's Firestore profile.
 *
 * @returns {Promise<{ data: object|null, error: string|null }>}
 */
export async function getCurrentRecruiterProfile() {
  const user = auth.currentUser;
  if (!user) return { data: null, error: 'No user signed in.' };

  try {
    const snap = await getDoc(doc(db, 'recruiters', user.uid));
    return { data: snap.exists() ? snap.data() : null, error: null };
  } catch (e) {
    console.error('[firebase.js] getCurrentRecruiterProfile:', e.code, e.message);
    return { data: null, error: fmtError(e) };
  }
}

console.log('[firebase.js] ✓ loaded — Firebase 11.6.0');