// ── recruit.js — Firebase integration for TalentBridge recruiter portal ───────
// Matches candlogin.js schema exactly:
//   • candidates/{uid}  →  { email, name, role:'candidate', interviewStatus,
//                            assignedInterviewSets[], interviewAnswers[],
//                            answersSubmittedAt, createdAt }
//   • recruiters/{uid}/interviewSets/{setId}  →  question sets (source of truth)
//   • interviewSets/{setId}  →  mirror copy for candidate reads (no recruiter UID needed)
//   • recruiters/{uid}/evaluations/{id}  →  evaluation results
//
// Firebase SDK:  11.6.0  (matches candlogin.js)
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp,
  arrayUnion,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';

// ─── 🔧  Replace with your Firebase project credentials ──────────────────────
// Firebase Console → Project Settings → General → Your apps
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
// ─────────────────────────────────────────────────────────────────────────────

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Redirects to recruiterlogin.html if the current user is not a recruiter.
 * Also called automatically at module load (bottom of file).
 */
export function checkRecruiterAuth() {
  onAuthStateChanged(auth, user => {
    if (!user) {
      window.location.href = './recruiterlogin.html';
      return;
    }
    if (localStorage.getItem('titanRole') !== 'recruiter') {
      window.location.href = './welcome.html';
    }
  });
}

/**
 * Signs the recruiter out and returns them to the login page.
 */
export async function logoutRecruiter() {
  try {
    await signOut(auth);
    localStorage.removeItem('titanRole');
    localStorage.removeItem('titanName');
    localStorage.removeItem('titanCompany');
    localStorage.removeItem('titanEmail');
    window.location.href = './recruiterlogin.html';
  } catch (err) {
    console.error('[recruit.js] Logout error:', err);
    alert('Error logging out: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDIDATE RETRIEVAL
// Reads from `candidates` collection — written by candlogin.js on sign-up.
// Field names match candlogin.js exactly:
//   interviewStatus, assignedInterviewSets, interviewAnswers, answersSubmittedAt
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns all candidates (role === 'candidate') ordered by sign-up date (desc).
 * Each entry is shaped to match what recruiter.html expects.
 *
 * @returns {Promise<Array>}
 */
export async function getCandidatesWithAnswers() {
  const q = query(
    collection(db, 'candidates'),
    where('role', '==', 'candidate'),
    orderBy('createdAt', 'desc'),
  );
  const snapshot = await getDocs(q);
  const list = [];

  snapshot.forEach(snap => {
    const d = snap.data();
    list.push({
      id:           snap.id,
      email:        d.email  || 'Unknown',
      name:         d.name   || d.email || 'Unknown',
      // interviewAnswers is the canonical field name from candlogin.js
      answerCount:  Array.isArray(d.interviewAnswers) ? d.interviewAnswers.length : 0,
      submittedAt:  d.answersSubmittedAt || null,
      // interviewStatus: 'pending' | 'invited' | 'submitted'
      status:       d.interviewStatus || 'pending',
      assignedSets: d.assignedInterviewSets || [],
    });
  });

  return list;
}

/**
 * Returns a single candidate's answers by their Firestore UID.
 * Also returns fullTranscript if present.
 *
 * @param {string} candidateId
 * @returns {Promise<{ id, email, name, answers: string[], fullTranscript: string, status }>}
 */
export async function getCandidateAnswersById(candidateId) {
  const snap = await getDoc(doc(db, 'candidates', candidateId));
  if (!snap.exists()) throw new Error('Candidate not found');
  const d = snap.data();
  return {
    id:             candidateId,
    email:          d.email             || 'Unknown',
    name:           d.name              || d.email || 'Unknown',
    answers:        d.interviewAnswers  || [],   // canonical field from candlogin schema
    fullTranscript: d.fullTranscript    || '',
    transcriptUrl:  d.transcriptUrl     || null,
    submittedAt:    d.answersSubmittedAt || null,
    status:         d.interviewStatus   || 'pending',
    assignedSets:   d.assignedInterviewSets || [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Saves interview questions to Firestore and optionally assigns them to a candidate.
 *
 * Storage layout:
 *   recruiters/{uid}/interviewSets/{setId}   ← source of truth, secured to recruiter
 *   interviewSets/{setId}                    ← mirror, readable by candidate without recruiter UID
 *
 * On the candidate doc it updates:
 *   assignedInterviewSets  (arrayUnion)
 *   interviewStatus        → 'invited'
 *   invitedAt, invitedBy, recruiterEmail
 *
 * @param {string[]} questions
 * @param {string|null} candidateId   Firestore UID of the candidate
 * @param {string|null} fileUrl       Optional Storage download URL for job spec
 * @returns {Promise<string>}         Created set document ID
 */
export async function saveInterviewQuestions(questions, candidateId = null, fileUrl = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Questions must be a non-empty array');
  }

  const setData = {
    questions,
    count:          questions.length,
    createdAt:      serverTimestamp(),
    createdBy:      user.uid,
    recruiterEmail: user.email,
    status:         'active',
    candidateId:    candidateId || null,
    fileUrl:        fileUrl     || null,
  };

  // 1. Write to recruiter's own subcollection (secured)
  const setRef = await addDoc(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    setData,
  );

  if (candidateId) {
    // 2. Mirror to top-level interviewSets — candidate reads from here
    await setDoc(doc(db, 'interviewSets', setRef.id), {
      ...setData,
      recruiterUid: user.uid,
      setId:        setRef.id,
    });

    // 3. Update candidate doc: mark invited, append set ID
    await updateDoc(doc(db, 'candidates', candidateId), {
      assignedInterviewSets: arrayUnion(setRef.id),
      interviewStatus:       'invited',
      invitedAt:             serverTimestamp(),
      invitedBy:             user.uid,
      recruiterEmail:        user.email,
    }).catch(async () => {
      // Candidate doc may not exist yet — create with merge
      await setDoc(doc(db, 'candidates', candidateId), {
        assignedInterviewSets: [setRef.id],
        interviewStatus:       'invited',
        invitedAt:             serverTimestamp(),
        invitedBy:             user.uid,
        recruiterEmail:        user.email,
      }, { merge: true });
    });
  }

  return setRef.id;
}

/**
 * Returns all active question sets created by the currently signed-in recruiter.
 *
 * @returns {Promise<Array>}
 */
export async function getRecruiterQuestionSets() {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  const q = query(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  const sets = [];
  snap.forEach(d => sets.push({ id: d.id, ...d.data() }));
  return sets;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGNED QUESTIONS — FETCH FOR CANDIDATE
// Used by candidate-voice.html to retrieve the recruiter-sent question set.
// Reads from the top-level `interviewSets` mirror (no recruiter UID required).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetches the most recently assigned question set for a given candidate UID.
 *
 * Lookup order:
 *   1. candidate doc → assignedInterviewSets[] → interviewSets/{setId}
 *   2. query interviewSets where candidateId == uid (fallback)
 *
 * @param {string} candidateId  Firebase Auth UID
 * @returns {Promise<{ questions: string[], setId: string } | null>}
 */
export async function getAssignedQuestionsForCandidate(candidateId) {
  // 1. Read candidate doc for assigned set IDs
  const candDoc = await getDoc(doc(db, 'candidates', candidateId));
  if (candDoc.exists()) {
    const assignedSets = candDoc.data().assignedInterviewSets || [];
    if (assignedSets.length > 0) {
      const latestSetId = assignedSets[assignedSets.length - 1];
      const setSnap     = await getDoc(doc(db, 'interviewSets', latestSetId));
      if (setSnap.exists() && setSnap.data().questions?.length) {
        return { questions: setSnap.data().questions, setId: latestSetId };
      }
    }
  }

  // 2. Fallback: query the mirror collection directly by candidateId
  const q = query(
    collection(db, 'interviewSets'),
    where('candidateId', '==', candidateId),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    const latest = snap.docs[0];
    if (latest.data().questions?.length) {
      return { questions: latest.data().questions, setId: latest.id };
    }
  }

  return null; // No questions assigned yet
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVIEW SUBMISSION — CANDIDATE SAVES ANSWERS
// Writes to candidate doc using candlogin.js field names:
//   interviewAnswers, interviewStatus:'submitted', answersSubmittedAt
// Also uploads transcript to Storage and records in global submissions collection.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Called by candidate-voice.html when the interview is finished.
 *
 * @param {object} payload
 *   candidateId     string   Firebase Auth UID
 *   candidateEmail  string
 *   answers         string[] per-question answers array
 *   questions       string[] original questions (for recruiter context)
 *   fullTranscript  string   raw text of the full interview
 *   setId           string|null
 * @returns {Promise<{ transcriptUrl: string|null }>}
 */
export async function saveInterviewSubmission({
  candidateId,
  candidateEmail,
  answers,
  questions,
  fullTranscript,
  setId,
}) {
  // 1. Upload transcript text to Firebase Storage
  let transcriptUrl = null;
  try {
    const blob  = new Blob([fullTranscript], { type: 'text/plain' });
    const sRef  = storageRef(storage, `transcripts/${candidateId}_${Date.now()}.txt`);
    const snap  = await uploadBytes(sRef, blob);
    transcriptUrl = await getDownloadURL(snap.ref);
  } catch (e) {
    console.warn('[recruit.js] Transcript upload failed:', e.message);
  }

  const submissionPayload = {
    candidateId,
    candidateEmail,
    answers,
    questions,
    fullTranscript,
    transcriptUrl:  transcriptUrl || null,
    setId:          setId || null,
    submittedAt:    serverTimestamp(),
    status:         'submitted',
  };

  // 2. Global submissions collection (recruiter can query without candidate UID)
  await addDoc(collection(db, 'submissions'), submissionPayload);

  // 3. Update candidate top-level doc — use candlogin.js field names
  const candUpdate = {
    interviewAnswers:   answers,       // ← candlogin.js canonical field
    interviewStatus:    'submitted',   // ← candlogin.js canonical field
    answersSubmittedAt: serverTimestamp(),
    fullTranscript,
    transcriptUrl:      transcriptUrl || null,
    lastSetId:          setId || null,
  };

  await updateDoc(doc(db, 'candidates', candidateId), candUpdate)
    .catch(async () => {
      // Create the doc if it doesn't exist
      await setDoc(doc(db, 'candidates', candidateId), {
        email:        candidateEmail,
        role:         'candidate',
        ...candUpdate,
      }, { merge: true });
    });

  return { transcriptUrl };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER EVALUATION
// Full scoring logic from the uploaded recruit.js — preserved intact.
// ═══════════════════════════════════════════════════════════════════════════════

export async function evaluateCandidateAnswers(questions, answers) {
  const results = {
    totalQuestions: questions.length,
    totalAnswers:   answers.length,
    scores:         [],
    overallScore:   0,
    feedback:       '',
    timestamp:      new Date().toLocaleDateString(),
  };

  for (let i = 0; i < Math.max(questions.length, answers.length); i++) {
    results.scores.push(
      _scoreSingleAnswer(questions[i] || 'N/A', answers[i] || '', i + 1),
    );
  }

  if (results.scores.length) {
    results.overallScore = Math.round(
      results.scores.reduce((s, r) => s + r.score, 0) / results.scores.length,
    );
  }

  results.feedback = _generateFeedback(results);
  await _saveEvaluationToFirebase(questions, answers, results);
  return results;
}

function _scoreSingleAnswer(question, answer, num) {
  const s = { questionNumber: num, question, answer, score: 0, details: [] };
  if (!answer.trim()) { s.details.push('No answer provided'); return s; }

  const wc          = answer.trim().split(/\s+/).length;
  const lengthScore = Math.min(100, (wc / 50) * 100);
  s.details.push(`Words: ${wc}`);

  const completeness = _calcCompleteness(answer);
  const relevance    = _calcRelevance(answer, question);

  s.score = Math.round((lengthScore + completeness + relevance) / 3);
  s.details.push(
    `Completeness: ${completeness.toFixed(0)}%`,
    `Relevance: ${relevance.toFixed(0)}%`,
  );
  return s;
}

function _calcCompleteness(answer) {
  const indicators = [
    'because', 'therefore', 'for example', 'specifically', 'such as',
    'including', 'experience', 'project', 'developed', 'created',
    'implemented', 'i ', 'we ',
  ];
  const lower   = answer.toLowerCase();
  const matches = indicators.filter(i => lower.includes(i)).length;
  return Math.min(100, (matches / indicators.length) * 100);
}

function _calcRelevance(answer, question) {
  const qwords = question.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  if (!qwords.length) return 50;
  const al = answer.toLowerCase();
  return (qwords.filter(w => al.includes(w)).length / qwords.length) * 100;
}

function _generateFeedback({ overallScore, totalQuestions, totalAnswers }) {
  let fb = totalAnswers < totalQuestions
    ? `⚠️ Missing ${totalQuestions - totalAnswers} answer(s). ` : '';
  if (overallScore >= 80)
    fb += `Excellent responses — strong detail and relevance. Score: ${overallScore}/100`;
  else if (overallScore >= 60)
    fb += `Good overall. Score: ${overallScore}/100. More specific examples would help.`;
  else if (overallScore >= 40)
    fb += `Average. Score: ${overallScore}/100. Consider a follow-up call.`;
  else
    fb += `Score: ${overallScore}/100. Responses lack detail — further discussion recommended.`;
  return fb;
}

async function _saveEvaluationToFirebase(questions, answers, results) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, 'recruiters', user.uid, 'evaluations'), {
      questions,
      answers,
      overallScore:   results.overallScore,
      scores:         results.scores,
      feedback:       results.feedback,
      createdAt:      serverTimestamp(),
      evaluatorEmail: user.email,
    });
  } catch (err) {
    console.error('[recruit.js] Error saving evaluation:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL EXPOSURE
// All functions bound to window so inline <script> blocks in recruiter.html
// and candidate-voice.html can call them without ES-module imports.
// ═══════════════════════════════════════════════════════════════════════════════

window.checkRecruiterAuth               = checkRecruiterAuth;
window.logoutRecruiter                  = logoutRecruiter;
window.getCandidatesWithAnswers         = getCandidatesWithAnswers;
window.getCandidateAnswersById          = getCandidateAnswersById;
window.saveInterviewQuestions           = saveInterviewQuestions;
window.getRecruiterQuestionSets         = getRecruiterQuestionSets;
window.getAssignedQuestionsForCandidate = getAssignedQuestionsForCandidate;
window.saveInterviewSubmission          = saveInterviewSubmission;
window.evaluateCandidateAnswers         = evaluateCandidateAnswers;

// Auto-run auth guard when loaded on recruiter pages
checkRecruiterAuth();

console.log('[recruit.js] ✓ loaded — Firebase 11.6.0, all globals registered');