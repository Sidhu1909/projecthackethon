// ── firebase.js ──────────────────────────────────────────────────────────────
// Drop this file in the same directory as your recruiter-login.html.
// Replace every placeholder value inside firebaseConfig with your real
// project credentials from: Firebase Console → Project Settings → General.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ─── 🔧 YOUR CONFIG — replace with values from Firebase Console ──────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
// ─────────────────────────────────────────────────────────────────────────────

const app    = initializeApp(firebaseConfig);
const auth   = getAuth(app);
export const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise Firebase error codes into a plain string the UI can consume. */
function extractMessage(err) {
  return err?.code ?? err?.message ?? "unknown-error";
}

// ── Auth exports ─────────────────────────────────────────────────────────────

/**
 * Create a new account with email + password.
 * @returns {{ user: import("firebase/auth").User|null, error: string|null }}
 */
export async function signUpWithEmail(email, password) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return { user: credential.user, error: null };
  } catch (err) {
    return { user: null, error: extractMessage(err) };
  }
}

/**
 * Sign in with email + password.
 * @returns {{ user: import("firebase/auth").User|null, error: string|null }}
 */
export async function signInWithEmail(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return { user: credential.user, error: null };
  } catch (err) {
    return { user: null, error: extractMessage(err) };
  }
}

/**
 * Sign in (or sign up) via Google popup.
 * @returns {{ user: import("firebase/auth").User|null, error: string|null }}
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { user: result.user, error: null };
  } catch (err) {
    return { user: null, error: extractMessage(err) };
  }
}

/**
 * Send a password-reset email.
 * Resolves silently even if the address isn't registered (Firebase behaviour).
 * @returns {{ error: string|null }}
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { error: null };
  } catch (err) {
    return { error: extractMessage(err) };
  }
}

/**
 * Subscribe to auth-state changes.
 * The callback receives `{ isLoggedIn: boolean, user: User|null }`.
 * @param {(state: { isLoggedIn: boolean, user: any }) => void} callback
 * @returns {import("firebase/auth").Unsubscribe}
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback({ isLoggedIn: !!user, user: user ?? null });
  });
}

/**
 * Sign the current user out.
 */
export async function logout() {
  try {
    await signOut(auth);
    return { error: null };
  } catch (err) {
    return { error: extractMessage(err) };
  }
}

// ── Firestore exports ─────────────────────────────────────────────────────────

/**
 * Save (or merge-update) a recruiter profile document.
 * Called automatically from the login page after successful sign-up.
 * @param {string} uid  Firebase Auth UID
 * @param {object} data Profile fields (name, company, email, role, createdAt)
 */
export async function saveRecruiterProfile(uid, data) {
  try {
    await setDoc(doc(db, "recruiters", uid), data, { merge: true });
    return { error: null };
  } catch (err) {
    console.error("saveRecruiterProfile:", err);
    return { error: extractMessage(err) };
  }
}

/**
 * Fetch a recruiter profile document.
 * @param {string} uid
 * @returns {{ data: object|null, error: string|null }}
 */
export async function getRecruiterProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "recruiters", uid));
    return { data: snap.exists() ? snap.data() : null, error: null };
  } catch (err) {
    return { data: null, error: extractMessage(err) };
  }
}

// ── Named re-export so the login page can import `db` directly ────────────────
// (already exported above as `export const db = getFirestore(app)`)