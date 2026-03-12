// ── candlogin.js ─────────────────────────────────────────────────────────────
// Firebase Authentication bridge for the candidate voice-auth page.
// Exposes attemptFirebaseSignIn and attemptFirebaseSignUp to window scope
// so the non-module voice-auth script can call them.
//
// 🔧 Replace firebaseConfig values with your real Firebase project credentials.
//    Firebase Console → Project Settings → General → Your apps
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp }        from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ─── 🔧 YOUR CONFIG ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
// ─────────────────────────────────────────────────────────────────────────────

let app, auth, db;

try {
  app  = initializeApp(firebaseConfig, "candlogin"); // named instance avoids clash with firebase.js
  auth = getAuth(app);
  db   = getFirestore(app);
} catch (err) {
  console.error("[candlogin] Firebase init error:", err.message);
}

// ── Dashboard redirect URL ────────────────────────────────────────────────────
// Change this to wherever you want candidates to land after auth.
const CANDIDATE_DASHBOARD_URL = "./candidate-interview.html";

// ── Helper: normalise a Firebase error code to a readable string ──────────────
function fmtError(err) {
  const code = err?.code ?? "";
  if (code.includes("wrong-password") || code.includes("invalid-credential"))
    return "Incorrect email or password.";
  if (code.includes("user-not-found"))   return "No account found with that email.";
  if (code.includes("email-already-in-use")) return "An account with that email already exists.";
  if (code.includes("weak-password"))    return "Password is too weak (min 6 chars).";
  if (code.includes("invalid-email"))    return "That doesn't look like a valid email.";
  if (code.includes("too-many-requests")) return "Too many attempts — please wait a moment.";
  return err?.message ?? "An unexpected error occurred.";
}

// ── Convert spoken email to typed email ──────────────────────────────────────
// e.g. "john at example dot com" → "john@example.com"
function spokenToEmail(spoken) {
  return spoken
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "")
    .trim();
}

// ── attemptFirebaseSignIn ─────────────────────────────────────────────────────
// Called from the non-module voice-auth script via window.attemptFirebaseSignIn
// spokenEmail    — normalised spoken string e.g. "john at example dot com"
// spokenPassword — normalised spoken password string
// Returns Promise<{ success: boolean, error: string|null }>
async function attemptFirebaseSignIn(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };

  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Store role so the dashboard can greet the user correctly
    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signIn error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

// ── attemptFirebaseSignUp ─────────────────────────────────────────────────────
// Called from the non-module voice-auth script via window.attemptFirebaseSignUp
// spokenEmail    — normalised spoken string
// spokenPassword — normalised spoken password string
// Returns Promise<{ success: boolean, error: string|null }>
async function attemptFirebaseSignUp(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };

  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    // Write a candidate profile document to Firestore
    await setDoc(
      doc(db, "candidates", uid),
      {
        email,
        role:      "candidate",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signUp error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

// ── Expose to window (non-module scripts can't import) ───────────────────────
window.attemptFirebaseSignIn  = attemptFirebaseSignIn;
window.attemptFirebaseSignUp  = attemptFirebaseSignUp;

// ── Auth-state guard ─────────────────────────────────────────────────────────
// If a candidate is already signed in when this page loads, skip auth entirely.
let _redirecting = false;

onAuthStateChanged(auth, (user) => {
  if (_redirecting) return;
  if (!user) return; // not signed in — stay on the auth page

  // Already authenticated — go straight to the interview
  _redirecting = true;
  localStorage.setItem("titanRole",  "candidate");
  localStorage.setItem("titanEmail", user.email ?? "");
  window.location.href = CANDIDATE_DASHBOARD_URL;
});

// Export for any ES-module consumers (optional)
export { attemptFirebaseSignIn, attemptFirebaseSignUp };