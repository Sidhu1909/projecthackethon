// ── candlogin.js ─────────────────────────────────────────────────────────────
// Firebase Authentication bridge for the candidate voice-auth page.
// Firebase SDK: 11.6.0
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp }        from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyD3c6gMQt00siR70-B93qBjVqYQAjrM3W4",
  authDomain:        "titan-fde30.firebaseapp.com",
  projectId:         "titan-fde30",
  storageBucket:     "titan-fde30.firebasestorage.app",
  messagingSenderId: "545954155049",
  appId:             "1:545954155049:web:59e785904b07cda5a4ea38",
  measurementId:     "G-4MDFGCVS5H",
};

let app, auth, db;
try {
  app  = initializeApp(firebaseConfig, "candlogin");
  auth = getAuth(app);
  db   = getFirestore(app);
  console.log("[candlogin] Firebase initialised ✓");
} catch (err) {
  console.error("[candlogin] Firebase init error:", err.message);
}

function fmtError(err) {
  const code = err?.code ?? "";
  if (code.includes("wrong-password") || code.includes("invalid-credential"))
    return "Incorrect email or password.";
  if (code.includes("user-not-found"))       return "No account found with that email.";
  if (code.includes("email-already-in-use")) return "An account with that email already exists.";
  if (code.includes("weak-password"))        return "Password is too weak — minimum 6 characters.";
  if (code.includes("invalid-email"))        return "That doesn't look like a valid email address.";
  if (code.includes("too-many-requests"))    return "Too many attempts — please wait a moment.";
  return err?.message ?? "An unexpected error occurred.";
}

function spokenToEmail(spoken) {
  return spoken
    .toLowerCase()
    .replace(/\s+at\s+/g,  "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "")
    .trim();
}

async function attemptFirebaseSignIn(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };
  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    localStorage.setItem("titanUID",   credential.user.uid);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signIn error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

async function attemptFirebaseSignUp(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };
  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    await setDoc(doc(db, "candidates", uid), {
      email,
      role:                  "candidate",
      interviewStatus:       "pending",
      assignedInterviewSets: [],
      interviewAnswers:      [],
      answersSubmittedAt:    null,
      fullTranscript:        null,
      transcriptUrl:         null,
      lastSetId:             null,
      createdAt:             serverTimestamp(),
      updatedAt:             serverTimestamp(),
    }, { merge: true });
    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    localStorage.setItem("titanUID",   uid);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signUp error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

window.attemptFirebaseSignIn  = attemptFirebaseSignIn;
window.attemptFirebaseSignUp  = attemptFirebaseSignUp;
console.log("[candlogin] ✓ loaded — window.attemptFirebaseSignIn & SignUp ready");