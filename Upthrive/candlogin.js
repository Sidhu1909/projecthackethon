// ── candlogin.js ─────────────────────────────────────────────────────────────
// Firebase Authentication bridge for the candidate voice-auth page.
// Exposes attemptFirebaseSignIn and attemptFirebaseSignUp to window scope
// so the non-module voice-auth script can call them.
//
// Schema written to candidates/{uid}:
//   { email, role:'candidate', createdAt, updatedAt,
//     interviewStatus:'pending', assignedInterviewSets:[],
//     interviewAnswers:[], answersSubmittedAt:null }
//
// These field names are read by recruit.js — do NOT rename them.
//
// Firebase SDK: 11.6.0  (matches recruit.js)
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
  app  = initializeApp(firebaseConfig, "candlogin"); // named instance avoids clash with recruit.js
  auth = getAuth(app);
  db   = getFirestore(app);
} catch (err) {
  console.error("[candlogin] Firebase init error:", err.message);
}

// ── Redirect URL after successful auth ───────────────────────────────────────
// candidate-voice.html is the voice interview portal (matches your file name).
const CANDIDATE_DASHBOARD_URL = "./candidate-voice.html";

// ── Helper: normalise a Firebase error code to a readable string ──────────────
function fmtError(err) {
  const code = err?.code ?? "";
  if (code.includes("wrong-password") || code.includes("invalid-credential"))
    return "Incorrect email or password.";
  if (code.includes("user-not-found"))       return "No account found with that email.";
  if (code.includes("email-already-in-use")) return "An account with that email already exists.";
  if (code.includes("weak-password"))        return "Password is too weak (min 6 chars).";
  if (code.includes("invalid-email"))        return "That doesn't look like a valid email.";
  if (code.includes("too-many-requests"))    return "Too many attempts — please wait a moment.";
  return err?.message ?? "An unexpected error occurred.";
}

// ── Convert spoken email to typed email ──────────────────────────────────────
// e.g. "john at example dot com" → "john@example.com"
function spokenToEmail(spoken) {
  return spoken
    .toLowerCase()
    .replace(/\s+at\s+/g,  "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "")
    .trim();
}

// ── attemptFirebaseSignIn ─────────────────────────────────────────────────────
// Called from the non-module voice-auth script via window.attemptFirebaseSignIn.
// spokenEmail    — normalised spoken string e.g. "john at example dot com"
// spokenPassword — normalised spoken password string
// Returns Promise<{ success: boolean, error: string|null }>
async function attemptFirebaseSignIn(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };

  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // Store role + identity so candidate-voice.html knows who is signed in
    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    localStorage.setItem("titanUID",   credential.user.uid);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signIn error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

// ── attemptFirebaseSignUp ─────────────────────────────────────────────────────
// Called from the non-module voice-auth script via window.attemptFirebaseSignUp.
// spokenEmail    — normalised spoken string
// spokenPassword — normalised spoken password string
// Returns Promise<{ success: boolean, error: string|null }>
async function attemptFirebaseSignUp(spokenEmail, spokenPassword) {
  if (!auth) return { success: false, error: "Auth service unavailable." };

  const email    = spokenToEmail(spokenEmail);
  const password = spokenPassword.trim();

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid        = credential.user.uid;

    // Write a full candidate profile to Firestore.
    // Field names here MUST match what recruit.js reads (getCandidatesWithAnswers,
    // getCandidateAnswersById, getAssignedQuestionsForCandidate).
    await setDoc(
      doc(db, "candidates", uid),
      {
        email,
        role:                  "candidate",
        // Status fields read by recruit.js
        interviewStatus:       "pending",           // 'pending' | 'invited' | 'submitted'
        assignedInterviewSets: [],                  // arrayUnion'd by saveInterviewQuestions
        interviewAnswers:      [],                  // filled by saveInterviewSubmission
        answersSubmittedAt:    null,
        fullTranscript:        null,
        transcriptUrl:         null,
        lastSetId:             null,
        // Timestamps
        createdAt:             serverTimestamp(),
        updatedAt:             serverTimestamp(),
      },
      { merge: true },
    );

    localStorage.setItem("titanRole",  "candidate");
    localStorage.setItem("titanEmail", email);
    localStorage.setItem("titanUID",   uid);
    return { success: true, error: null };
  } catch (err) {
    console.error("[candlogin] signUp error:", err.code, err.message);
    return { success: false, error: fmtError(err) };
  }
}

// ── Expose to window (non-module scripts can't import) ───────────────────────
window.attemptFirebaseSignIn  = attemptFirebaseSignIn;
window.attemptFirebaseSignUp  = attemptFirebaseSignUp;

/* ───────────────────────────────────────────────────────────────────────────
   Voice-auth UI & state from candlogin.html (moved inline script here)
────────────────────────────────────────────────────────────────────────────*/

/* ════════════════════════════════════════
   CONFIG
════════════════════════════════════════ */
const CREDENTIALS = {
  email: 'john at example dot com',   // spoken form
  password: 'open sesame'
};

// Normalise spoken text for comparison
function normalize(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ════════════════════════════════════════
   STATE
════════════════════════════════════════ */
let state = 'idle';   // idle | speaking | waiting | listening | done
let authStep = 'email'; // email | password
let spokenEmail = '';
let spokenPassword = '';
let recognition = null;
let isSpeaking = false;

/* ════════════════════════════════════════
   WAVEFORM
════════════════════════════════════════ */
const viz = document.getElementById('viz');
const BAR_COUNT = 28;
for (let i = 0; i < BAR_COUNT; i++) {
  const b = document.createElement('div');
  b.className = 'bar';
  const maxH = 12 + Math.sin(i / BAR_COUNT * Math.PI) * 32;
  b.style.setProperty('--h', maxH + 'px');
  b.style.setProperty('--dur', (0.5 + Math.random() * 0.7).toFixed(2) + 's');
  b.style.setProperty('--del', (i / BAR_COUNT * 0.5).toFixed(2) + 's');
  viz.appendChild(b);
}

function setBars(mode) {
  // mode: idle | listening | speaking | success | error
  viz.querySelectorAll('.bar').forEach(b => {
    b.className = 'bar';
    if (mode === 'listening') { b.classList.add('active'); }
    else if (mode === 'speaking') { b.classList.add('active'); }
    else if (mode === 'success') { b.classList.add('active', 'success'); }
    else if (mode === 'error')   { b.classList.add('active', 'error'); }
  });
}

/* ════════════════════════════════════════
   ARIA LIVE
════════════════════════════════════════ */
function announce(msg) {
  const el = document.getElementById('aria-live');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

/* ════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════ */
function setPrompt(text) {
  document.getElementById('prompt-text').textContent = text;
}

function setTranscript(text) {
  const el = document.getElementById('transcript-text');
  el.textContent = text;
}

function setPill(mode, label) {
  const pill = document.getElementById('state-pill');
  const lbl  = document.getElementById('state-label');
  pill.className = 'state-pill ' + mode;
  lbl.textContent = label;
}

function setMicState(active) {
  const btn = document.getElementById('mic-btn');
  btn.className = 'mic-btn' + (active ? ' listening' : '');
  btn.setAttribute('aria-label', active ? 'Listening… speak now' : 'Tap to speak');
}

function enableMic(on) {
  const btn = document.getElementById('mic-btn');
  if (on) btn.classList.remove('disabled');
  else    btn.classList.add('disabled');
}

function updateSteps(step) {
  // step: 1, 2, 3
  const s1 = document.getElementById('step1');
  const s2 = document.getElementById('step2');
  const s3 = document.getElementById('step3');
  const l1 = document.getElementById('line1');
  const l2 = document.getElementById('line2');
  const lbl= document.getElementById('step-label');

  s1.className = 'step-dot' + (step > 1 ? ' done' : step === 1 ? ' active' : '');
  s2.className = 'step-dot' + (step > 2 ? ' done' : step === 2 ? ' active' : '');
  s3.className = 'step-dot' + (step === 3 ? ' active' : '');
  l1.className = 'step-line' + (step > 1 ? ' done' : '');
  l2.className = 'step-line' + (step > 2 ? ' done' : '');

  if (step === 1) lbl.textContent = 'STEP 1 OF 2 — EMAIL';
  if (step === 2) lbl.textContent = 'STEP 2 OF 2 — PASSWORD';
  if (step === 3) lbl.textContent = 'VERIFYING…';
}

/* ════════════════════════════════════════
   SPEECH SYNTHESIS
════════════════════════════════════════ */
function speak(text, onEnd) {
  if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  isSpeaking = true;
  setPill('speaking', 'SPEAKING');
  setBars('speaking');

  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.92;
  utt.pitch = 1.0;
  utt.volume = 1;

  // Pick a clear, natural voice
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    /Samantha|Karen|Daniel|Google UK|Google US|Alex/i.test(v.name)
  ) || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utt.voice = preferred;

  utt.onend = () => {
    isSpeaking = false;
    if (onEnd) onEnd();
  };
  utt.onerror = () => { isSpeaking = false; if (onEnd) onEnd(); };

  announce(text); // also announce to screen readers
  speechSynthesis.speak(utt);
}

/* ════════════════════════════════════════
   SPEECH RECOGNITION
════════════════════════════════════════ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function listen(onResult, onError) {
  if (!SR) { onError('Speech recognition not supported'); return; }
  if (recognition) { try { recognition.abort(); } catch(e) {} }

  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  setPill('listening', 'LISTENING');
  setMicState(true);
  setBars('listening');

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    setTranscript('"' + (final || interim) + '"');
    if (final) {
      recognition.stop();
      onResult(final.trim());
    }
  };

  recognition.onerror = (e) => {
    setMicState(false);
    if (e.error === 'no-speech') onError('No speech detected. Please try again.');
    else if (e.error === 'not-allowed') onError('Microphone access denied. Please allow mic access.');
    else onError('Error: ' + e.error);
  };

  recognition.onend = () => { setMicState(false); };
  recognition.start();
}

/* ════════════════════════════════════════
   AUTH FLOW
════════════════════════════════════════ */
function startFlow() {
  authStep = 'email';
  spokenEmail = '';
  spokenPassword = '';
  updateSteps(1);
  setTranscript('');
  enableMic(false);
  setPill('speaking', 'SPEAKING');

  speak("Welcome. This is the voice authentication system for TalentBridge. Please say your email address after the tone.", () => {
    setPrompt("Please say your email address.");
    announce("Please say your email address. Tap the microphone or press Space to begin.");
    setPill('', 'READY');
    setBars('idle');
    enableMic(true);
  });

  setPrompt("Welcome to TalentBridge voice sign-in.");
}

function handleMicClick() {
  if (state === 'listening') return;
  if (authStep === 'email') captureEmail();
  else if (authStep === 'password') capturePassword();
}

function captureEmail() {
  state = 'listening';
  enableMic(false);
  setPrompt("Listening for your email…");
  announce("Listening. Please say your email address now.");

  listen((result) => {
    state = 'processing';
    spokenEmail = normalize(result);
    setTranscript('"' + result + '"');
    setBars('idle');
    setPill('', 'RECEIVED');

    // Confirm and move to password
    speak('Got it. Now please say your password.', () => {
      authStep = 'password';
      updateSteps(2);
      setPrompt("Please say your password.");
      announce("Please say your password. Tap the microphone or press Space.");
      setTranscript('');
      setPill('', 'READY');
      enableMic(true);
      state = 'waiting';
    });

  }, (err) => {
    state = 'idle';
    setBars('idle');
    setPill('error', 'ERROR');
    setPrompt(err);
    announce(err + " Please try again.");
    setTimeout(() => {
      setPrompt("Please say your email address.");
      setPill('', 'READY');
      enableMic(true);
    }, 2800);
  });
}

function capturePassword() {
  state = 'listening';
  enableMic(false);
  setPrompt("Listening for your password…");
  announce("Listening. Please say your password now.");

  listen((result) => {
    state = 'verifying';
    spokenPassword = normalize(result);
    setTranscript('"' + result + '"');
    setBars('idle');
    setPill('', 'VERIFYING');
    updateSteps(3);

    setTimeout(() => verifyCredentials(), 600);

  }, (err) => {
    state = 'idle';
    setBars('idle');
    setPill('error', 'ERROR');
    setPrompt(err);
    announce(err + " Please try again.");
    setTimeout(() => {
      setPrompt("Please say your password.");
      setPill('', 'READY');
      enableMic(true);
    }, 2800);
  });
}

function verifyCredentials() {
  // use firebase instead of dummy credentials
  if (window.attemptFirebaseSignIn) {
    window.attemptFirebaseSignIn(spokenEmail, spokenPassword).then(result => {
      handleFirebaseResult(result);
    }).catch(err => {
      console.error('firebase attempt failed:', err);
      handleFirebaseResult({ success: false, error: 'Sign-in error' });
    });
  } else {
    // fallback to demo mode if firebase not loaded
    const emailOk    = spokenEmail    === normalize(CREDENTIALS.email);
    const passwordOk = spokenPassword === normalize(CREDENTIALS.password);
    const granted    = emailOk && passwordOk;
    handleFirebaseResult({ success: granted, error: granted ? null : 'Credentials do not match' });
  }
}

function handleFirebaseResult(result) {
  const authSection  = document.getElementById('auth-section');
  const resultScreen = document.getElementById('result-screen');

  authSection.style.display = 'none';
  resultScreen.classList.add('show');

  if (result.success) {
    setBars('success');
    setPill('success', 'GRANTED');
    resultScreen.innerHTML = `
      <div class="result-icon success" aria-hidden="true">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="result-title success">Access Granted</div>
      <div class="result-sub">Identity verified — welcome back</div>
      <button class="retry-btn" onclick="resetFlow()" aria-label="Sign out and return to login">Sign Out</button>
    `;
    announce("Access granted. Identity verified. Welcome back.");
    speak("Access granted. Welcome back. You are now signed in.");
  } else {
    setBars('error');
    setPill('error', 'DENIED');

    const reason = result.error || 'credentials did not match';
    resultScreen.innerHTML = `
      <div class="result-icon error" aria-hidden="true">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
      <div class="result-title error">Access Denied</div>
      <div class="result-sub">${reason}</div>
      <button class="retry-btn" onclick="resetFlow()" aria-label="Try again">Try Again</button>
    `;
    announce("Access not granted. " + reason + ". Please try again.");
    speak("Access not granted. " + reason + ". Please try again.");
  }
}

function resetFlow() {
  speechSynthesis && speechSynthesis.cancel();
  state = 'idle';

  const authSection  = document.getElementById('auth-section');
  const resultScreen = document.getElementById('result-screen');

  resultScreen.classList.remove('show');
  resultScreen.innerHTML = '';
  authSection.style.display = '';

  setTranscript('');
  setBars('idle');
  setPill('', 'READY');
  updateSteps(1);
  enableMic(false);

  setTimeout(startFlow, 300);
}

/* ════════════════════════════════════════
   KEYBOARD SHORTCUT (Space = mic)
════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    handleMicClick();
  }
});

/* ════════════════════════════════════════
   BOOT
════════════════════════════════════════ */
// Voices load async
function boot() {
  if (speechSynthesis && speechSynthesis.getVoices().length === 0) {
    speechSynthesis.onvoiceschanged = startFlow;
  } else {
    setTimeout(startFlow, 1000);
  }
}

window.addEventListener('load', boot);
