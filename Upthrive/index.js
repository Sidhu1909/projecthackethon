// ── firebase.js ──────────────────────────────────────────────────────────────
// Place this file in the same folder as index.html (recruiter login page).
//
// 🔧 SETUP STEPS:
//   1. Go to https://console.firebase.google.com
//   2. Select your project → Project Settings (⚙) → General → Your apps
//   3. Copy the firebaseConfig values and paste them below
//   4. In Firebase Console → Authentication → Sign-in method:
//        • Enable "Email/Password"
//        • Enable "Google"
//   5. In Firebase Console → Firestore Database → Create database (test mode)
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp }      from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAnalytics }       from "https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔧 REPLACE THESE WITH YOUR REAL VALUES FROM FIREBASE CONSOLE
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID",   // optional — only if Analytics is enabled
};
// ─────────────────────────────────────────────────────────────────────────────

// ── Init ─────────────────────────────────────────────────────────────────────
let app, auth, db, analytics;

try {
  app       = initializeApp(firebaseConfig);
  auth      = getAuth(app);
  db        = getFirestore(app);

  // Analytics is optional — only initialise if measurementId is present
  if (firebaseConfig.measurementId && firebaseConfig.measurementId !== "YOUR_MEASUREMENT_ID") {
    analytics = getAnalytics(app);
  }
} catch (err) {
  console.error("Firebase init failed:", err.message);
  // Throw so the module script in index.html catches it cleanly
  throw err;
}

export { db };

// ── Google provider ───────────────────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Pull a readable string from a Firebase error.
 * Firebase errors carry a `code` like "auth/wrong-password";
 * falling back to the message keeps us safe for unknown shapes.
 */
function extractMessage(err) {
  return err?.code ?? err?.message ?? "unknown-error";
}

/**
 * Re-authenticate the current user with their existing password.
 * Firebase requires this before sensitive changes (email / password update).
 */
async function reauthenticate(currentPassword) {
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

// ── Exported helpers ──────────────────────────────────────────────────────────

/** Returns the currently signed-in Firebase user, or null. */
export function getCurrentUser() {
  return auth.currentUser ?? null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Create a new account with email + password.
 * @returns {{ user: User|null, error: string|null }}
 */
export async function signUpWithEmail(email, password) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return { user: credential.user, error: null };
  } catch (err) {
    console.error("signUpWithEmail:", err.code, err.message);
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
    console.error("signInWithEmail:", err.code, err.message);
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
    console.error("signInWithGoogle:", err.code, err.message);
    return { user: null, error: extractMessage(err) };
  }
}

/**
 * Send a password-reset email to the given address.
 * Firebase resolves silently even when the address isn't registered —
 * this is intentional (prevents user-enumeration attacks).
 * @returns {{ error: string|null }}
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { error: null };
  } catch (err) {
    console.error("resetPassword:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

/**
 * Subscribe to Firebase auth-state changes.
 * Callback receives { isLoggedIn: boolean, user: User|null }.
 *
 * Returns the unsubscribe function — call it to clean up listeners.
 *
 * @param {(state: { isLoggedIn: boolean, user: User|null }) => void} callback
 * @returns {() => void}  unsubscribe
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback({ isLoggedIn: !!user, user: user ?? null });
  });
}

/**
 * Sign the current user out and clear local storage keys.
 * @returns {{ error: string|null }}
 */
export async function logout() {
  try {
    await signOut(auth);
    localStorage.removeItem("titanRole");
    localStorage.removeItem("titanName");
    localStorage.removeItem("titanCompany");
    return { error: null };
  } catch (err) {
    console.error("logout:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

// ── Account updates ───────────────────────────────────────────────────────────

/**
 * Send a verification email to `newEmail`.
 * The change only takes effect once the user clicks the link in that email.
 * Also writes a `pendingEmail` field to Firestore for reference.
 *
 * @param {string} newEmail
 * @param {string} currentPassword  — needed for re-authentication
 * @returns {{ error: string|null }}
 */
export async function updateUserEmail(newEmail, currentPassword) {
  try {
    const user = auth.currentUser;
    if (!user) return { error: "auth/no-current-user" };

    const reauth = await reauthenticate(currentPassword);
    if (reauth.error) return reauth;

    await verifyBeforeUpdateEmail(user, newEmail);

    // Optimistically record the pending change in Firestore
    await updateDoc(doc(db, "recruiters", user.uid), {
      pendingEmail:             newEmail,
      emailUpdateRequestedAt:   serverTimestamp(),
    });

    return { error: null };
  } catch (err) {
    console.error("updateUserEmail:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

/**
 * Change the current user's password.
 * Re-authenticates first, then applies the new password and logs the
 * change timestamp in Firestore.
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

    await updateDoc(doc(db, "recruiters", user.uid), {
      passwordChangedAt: serverTimestamp(),
    });

    return { error: null };
  } catch (err) {
    console.error("updateUserPassword:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

/**
 * Update recruiter profile fields in both Firebase Auth and Firestore.
 *
 * Accepted keys: name, company, title, phone, location, bio, avatarUrl
 * Only the keys you pass are updated; everything else is untouched.
 *
 * @param {Partial<{ name: string, company: string, title: string, phone: string, location: string, bio: string, avatarUrl: string }>} updates
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

    // Keep Firebase Auth displayName in sync
    if (updates.name) {
      await updateProfile(user, { displayName: updates.name });
    }

    if (Object.keys(firestoreData).length > 0) {
      firestoreData.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "recruiters", user.uid), firestoreData);

      // Mirror to localStorage so the dashboard reads fresh values immediately
      if (updates.name)    localStorage.setItem("titanName",    updates.name);
      if (updates.company) localStorage.setItem("titanCompany", updates.company);
    }

    return { error: null };
  } catch (err) {
    console.error("updateRecruiterProfile:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

// ── Firestore ─────────────────────────────────────────────────────────────────

/**
 * Create or merge-update a recruiter Firestore document.
 * Called right after sign-up to persist the user's name, company, etc.
 *
 * @param {string} uid   Firebase Auth UID
 * @param {object} data  Fields to write (name, company, email, role, …)
 * @returns {{ error: string|null }}
 */
export async function saveRecruiterProfile(uid, data) {
  try {
    if (!uid) return { error: "missing-uid" };

    await setDoc(
      doc(db, "recruiters", uid),
      {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }   // won't overwrite fields you didn't pass
    );

    return { error: null };
  } catch (err) {
    console.error("saveRecruiterProfile:", err.code, err.message);
    return { error: extractMessage(err) };
  }
}

/**
 * Fetch a recruiter profile by UID.
 * @param {string} uid
 * @returns {{ data: object|null, error: string|null }}
 */
export async function getRecruiterProfile(uid) {
  try {
    if (!uid) return { data: null, error: "missing-uid" };
    const snap = await getDoc(doc(db, "recruiters", uid));
    return { data: snap.exists() ? snap.data() : null, error: null };
  } catch (err) {
    console.error("getRecruiterProfile:", err.code, err.message);
    return { data: null, error: extractMessage(err) };
  }
}

/**
 * Fetch the profile of whichever user is currently signed in.
 * Returns { data: null, error } if nobody is signed in.
 * @returns {{ data: object|null, error: string|null }}
 */
export async function getCurrentRecruiterProfile() {
  const user = auth.currentUser;
  if (!user) return { data: null, error: "auth/no-current-user" };
  return getRecruiterProfile(user.uid);
}