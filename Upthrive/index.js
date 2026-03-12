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
  updateEmail,
  verifyBeforeUpdateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
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

/** Returns the currently signed-in user, or null. */
export function getCurrentUser() {
  return auth.currentUser ?? null;
}

// ── Auth exports ─────────────────────────────────────────────────────────────

/**
 * Create a new account with email + password.
 * @returns {{ user: User|null, error: string|null }}
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
 * @returns {{ user: User|null, error: string|null }}
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
 * @returns {{ user: User|null, error: string|null }}
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
 * @returns {Unsubscribe}
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

// ── Account Update exports ────────────────────────────────────────────────────

/**
 * Re-authenticate the current user with their current password.
 * Required before sensitive operations (email/password change).
 * @param {string} currentPassword
 * @returns {{ error: string|null }}
 */
export async function reauthenticate(currentPassword) {
  try {
    const user = auth.currentUser;
    if (!user || !user.email) return { error: "auth/no-current-user" };
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    return { error: null };
  } catch (err) {
    return { error: extractMessage(err) };
  }
}

/**
 * Update the authenticated user's email address.
 * Sends a verification email to the new address before applying the change.
 * Also updates the email field in the Firestore recruiters document.
 *
 * @param {string} newEmail
 * @param {string} currentPassword  — required for re-authentication
 * @returns {{ error: string|null }}
 */
export async function updateUserEmail(newEmail, currentPassword) {
  try {
    const user = auth.currentUser;
    if (!user) return { error: "auth/no-current-user" };

    // Re-auth first (required by Firebase for sensitive operations)
    const reauth = await reauthenticate(currentPassword);
    if (reauth.error) return reauth;

    // Send verification to new address; change applies after the user clicks the link
    await verifyBeforeUpdateEmail(user, newEmail);

    // Optimistically update Firestore so local state stays in sync
    await updateDoc(doc(db, "recruiters", user.uid), {
      pendingEmail: newEmail,
      emailUpdateRequestedAt: serverTimestamp(),
    });

    return { error: null };
  } catch (err) {
    return { error: extractMessage(err) };
  }
}

/**
 * Update the authenticated user's password.
 * Requires re-authentication with the current password first.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {{ error: string|null }}
 */
export async function updateUserPassword(currentPassword, newPassword) {
  try {
    const user = auth.currentUser;
    if (!user) return { error: "auth/no-current-user" };

    const reauth = await reauthenticate(currentPassword);
    if (reauth.error) return reauth;

    await updatePassword(user, newPassword);

    // Record the timestamp in Firestore for audit trail
    await updateDoc(doc(db, "recruiters", user.uid), {
      passwordChangedAt: serverTimestamp(),
    });

    return { error: null };
  } catch (err) {
    return { error: extractMessage(err) };
  }
}

/**
 * Update the Auth display name and any writable Firestore profile fields.
 * Pass only the fields you want to change; everything else is left untouched.
 *
 * Supported fields: name, company, title, phone, location, bio, avatarUrl
 *
 * @param {object} updates  — e.g. { name: "Jane Doe", company: "Acme" }
 * @returns {{ error: string|null }}
 */
export async function updateRecruiterProfile(updates) {
  try {
    const user = auth.currentUser;
    if (!user) return { error: "auth/no-current-user" };

    const allowedFields = ["name", "company", "title", "phone", "location", "bio", "avatarUrl"];
    const firestoreData  = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) firestoreData[key] = updates[key];
    }

    // Sync display name to Firebase Auth as well
    if (updates.name) {
      await updateProfile(user, { displayName: updates.name });
    }

    // Persist to Firestore
    if (Object.keys(firestoreData).length > 0) {
      firestoreData.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "recruiters", user.uid), firestoreData);

      // Mirror changes to localStorage so other pages see them immediately
      if (updates.name)    localStorage.setItem("titanName",    updates.name);
      if (updates.company) localStorage.setItem("titanCompany", updates.company);
    }

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
    await setDoc(doc(db, "recruiters", uid), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
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

/**
 * Convenience: load the profile of whoever is currently signed in.
 * @returns {{ data: object|null, error: string|null }}
 */
export async function getCurrentRecruiterProfile() {
  const user = auth.currentUser;
  if (!user) return { data: null, error: "auth/no-current-user" };
  return getRecruiterProfile(user.uid);
}