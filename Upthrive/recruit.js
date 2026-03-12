// recruit.js — Firebase integration for recruiter interview management
// Candidates are pulled directly from the `candidates` Firestore collection
// (populated when a user signs up on cand.html / candidate login page).

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

// ─── Firebase config (same project as firebase.js) ───────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, user => callback(user));
}

export async function signOutUser() {
  await signOut(auth);
}

export function checkRecruiterAuth() {
  onAuthStateChanged(auth, user => {
    if (!user) {
      window.location.href = './recruiterlogin.html';
      return;
    }
    const role = localStorage.getItem('titanRole');
    if (role !== 'recruiter') {
      window.location.href = './welcome.html';
    }
  });
}

export async function logoutRecruiter() {
  try {
    await signOut(auth);
    localStorage.removeItem('titanRole');
    localStorage.removeItem('titanName');
    localStorage.removeItem('titanCompany');
    window.location.href = './recruiterlogin.html';
  } catch (err) {
    console.error('Logout error:', err);
    alert('Error logging out: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE RETRIEVAL
// Reads the top-level `candidates` collection — every user who signed up on
// cand.html is written there with { email, name, role:'candidate', ... }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return ALL candidates who have signed up (role === 'candidate').
 * Each entry: { id, email, name, answerCount, submittedAt, status }
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
      answerCount:  d.interviewAnswers ? d.interviewAnswers.length : 0,
      submittedAt:  d.answersSubmittedAt || null,
      status:       d.interviewStatus || 'pending',   // pending | invited | submitted
      assignedSets: d.assignedInterviewSets || [],
    });
  });
  return list;
}

/**
 * Fetch one candidate's answers by Firestore doc ID.
 */
export async function getCandidateAnswersById(candidateId) {
  const snap = await getDoc(doc(db, 'candidates', candidateId));
  if (!snap.exists()) throw new Error('Candidate not found');
  const d = snap.data();
  return {
    id:          candidateId,
    email:       d.email || 'Unknown',
    name:        d.name  || d.email || 'Unknown',
    answers:     d.interviewAnswers || [],
    submittedAt: d.answersSubmittedAt || null,
    status:      d.interviewStatus || 'pending',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save interview questions to Firestore under the recruiter's subcollection.
 * If candidateId is supplied the question set is also pushed onto the
 * candidate's `assignedInterviewSets` array so cand.html can fetch it.
 *
 * @param {string[]} questions
 * @param {string|null} candidateId   Firestore doc ID of the candidate
 * @param {string|null} fileUrl       Optional Storage download URL
 * @returns {Promise<string>}         Created document ID
 */
export async function saveInterviewQuestions(questions, candidateId = null, fileUrl = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Questions must be a non-empty array');
  }

  const setData = {
    questions,
    count:       questions.length,
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    recruiterEmail: user.email,
    status:      'active',
  };
  if (candidateId) setData.assignedTo = candidateId;
  if (fileUrl)     setData.fileUrl    = fileUrl;

  // Store under recruiters/{uid}/interviewSets
  const setRef = await addDoc(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    setData,
  );

  if (candidateId) {
    // Write a shallow copy under a shared top-level path so cand.html
    // can read it without needing the recruiter's UID at query time.
    await setDoc(
      doc(db, 'interviewSets', setRef.id),
      {
        ...setData,
        recruiterUid: user.uid,
        setId: setRef.id,
      },
    );

    // Update candidate doc: add setId, mark as invited
    await updateDoc(doc(db, 'candidates', candidateId), {
      assignedInterviewSets: arrayUnion(setRef.id),
      interviewStatus:       'invited',
      invitedAt:             serverTimestamp(),
      invitedBy:             user.uid,
      recruiterEmail:        user.email,
    });
  }

  return setRef.id;
}

/**
 * Get all active question sets saved by the current recruiter.
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

// ─────────────────────────────────────────────────────────────────────────────
// ANSWER EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

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
    results.scores.push(scoreSingleAnswer(
      questions[i] || 'N/A',
      answers[i]   || '',
      i + 1,
    ));
  }

  if (results.scores.length) {
    results.overallScore = Math.round(
      results.scores.reduce((s, r) => s + r.score, 0) / results.scores.length,
    );
  }

  results.feedback = generateFeedback(results);
  await saveEvaluationToFirebase(questions, answers, results);
  return results;
}

function scoreSingleAnswer(question, answer, num) {
  const s = { questionNumber: num, question, answer, score: 0, details: [] };
  if (!answer.trim()) { s.details.push('No answer provided'); return s; }
  const wc = answer.trim().split(/\s+/).length;
  const lengthScore = Math.min(100, (wc / 50) * 100);
  s.details.push(`Words: ${wc}`);
  const completeness = calcCompleteness(answer, question);
  const relevance    = calcRelevance(answer, question);
  s.score = Math.round((lengthScore + completeness + relevance) / 3);
  s.details.push(`Completeness: ${completeness.toFixed(0)}%`, `Relevance: ${relevance.toFixed(0)}%`);
  return s;
}

function calcCompleteness(answer, question) {
  const indicators = ['because','therefore','for example','specifically','such as',
    'including','experience','project','developed','created','implemented','i ','we '];
  const lower = answer.toLowerCase();
  const matches = indicators.filter(i => lower.includes(i)).length;
  return Math.min(100, (matches / indicators.length) * 100);
}

function calcRelevance(answer, question) {
  const qwords = question.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  if (!qwords.length) return 50;
  const al = answer.toLowerCase();
  return (qwords.filter(w => al.includes(w)).length / qwords.length) * 100;
}

function generateFeedback({ overallScore, totalQuestions, totalAnswers }) {
  let fb = totalAnswers < totalQuestions
    ? `⚠️ Missing ${totalQuestions - totalAnswers} answer(s). ` : '';
  if (overallScore >= 80) fb += `Excellent responses — strong detail and relevance. Score: ${overallScore}/100`;
  else if (overallScore >= 60) fb += `Good overall. Score: ${overallScore}/100. More specific examples would help.`;
  else if (overallScore >= 40) fb += `Average. Score: ${overallScore}/100. Consider a follow-up call.`;
  else fb += `Score: ${overallScore}/100. Responses lack detail — further discussion recommended.`;
  return fb;
}

async function saveEvaluationToFirebase(questions, answers, results) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, 'recruiters', user.uid, 'evaluations'), {
      questions, answers,
      overallScore:   results.overallScore,
      scores:         results.scores,
      feedback:       results.feedback,
      createdAt:      serverTimestamp(),
      evaluatorEmail: user.email,
    });
  } catch (err) {
    console.error('Error saving evaluation:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL EXPOSURE  (used by inline <script> in interview-manager.html)
// ─────────────────────────────────────────────────────────────────────────────
window.saveInterviewQuestions    = saveInterviewQuestions;
window.evaluateCandidateAnswers  = evaluateCandidateAnswers;
window.getRecruiterQuestionSets  = getRecruiterQuestionSets;
window.getCandidatesWithAnswers  = getCandidatesWithAnswers;
window.getCandidateAnswersById   = getCandidateAnswersById;
window.checkRecruiterAuth        = checkRecruiterAuth;
window.logoutRecruiter           = logoutRecruiter;

checkRecruiterAuth();
console.log('📋 recruit.js loaded');