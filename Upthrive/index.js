// ============================================
// firebase.js — Firebase Init + Auth (CDN)
// ============================================

import { initializeApp }        from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAnalytics }         from "https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js";
import { getFirestore, collection, onSnapshot, setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// ── Firebase Config ──────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD3c6gMQt00siR70-B93qBjVqYQAjrM3W4",
  authDomain: "titan-fde30.firebaseapp.com",
  projectId: "titan-fde30",
  storageBucket: "titan-fde30.firebasestorage.app",
  messagingSenderId: "545954155049",
  appId: "1:545954155049:web:59e785904b07cda5a4ea38",
  measurementId: "G-4MDFGCVS5H",
};

// ── Initialize ───────────────────────────────
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ============================================
// SIGN UP — Email & Password
// ============================================
export async function signUpWithEmail(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signed up:", userCredential.user.email);
    return { user: userCredential.user, error: null };
  } catch (error) {
    console.error("Sign-up error:", error.message);
    return { user: null, error: error.message };
  }
}

// ============================================
// SIGN IN — Email & Password
// ============================================
export async function signInWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log("Signed in:", userCredential.user.email);
    return { user: userCredential.user, error: null };
  } catch (error) {
    console.error("Sign-in error:", error.message);
    return { user: null, error: error.message };
  }
}

// ============================================
// SIGN IN — Google OAuth
// ============================================
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log("Google sign-in:", result.user.displayName);
    return { user: result.user, error: null };
  } catch (error) {
    console.error("Google sign-in error:", error.message);
    return { user: null, error: error.message };
  }
}

// ============================================
// SIGN OUT
// ============================================
export async function logOut() {
  try {
    await signOut(auth);
    console.log("User signed out");
    return { error: null };
  } catch (error) {
    console.error("Sign-out error:", error.message);
    return { error: error.message };
  }
}

// ============================================
// PASSWORD RESET
// ============================================
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    console.log("Password reset email sent to:", email);
    return { error: null };
  } catch (error) {
    console.error("Reset error:", error.message);
    return { error: error.message };
  }
}

// ============================================
// AUTH STATE LISTENER
// ============================================
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      callback({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        isLoggedIn: true,
      });
    } else {
      callback({ isLoggedIn: false });
    }
  });
}

// ── Optional exports of Firebase instances
export { auth, db, app, analytics, collection, onSnapshot };
