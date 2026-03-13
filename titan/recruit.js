// ── recruit.js — Firebase integration for TalentBridge recruiter portal ───────
// Matches candlogin.js schema exactly:
//   • candidates/{uid}  →  { email, name, role:'candidate', interviewStatus,
//                            assignedInterviewSets[], interviewAnswers[],
//                            answersSubmittedAt, createdAt,
//                            textFileUrl, textFileContent }   ← NEW
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
const firebaseConfig = {
  apiKey: "AIzaSyD3c6gMQt00siR70-B93qBjVqYQAjrM3W4",
  authDomain: "titan-fde30.firebaseapp.com",
  projectId: "titan-fde30",
  storageBucket: "titan-fde30.firebasestorage.app",
  messagingSenderId: "545954155049",
  appId: "1:545954155049:web:59e785904b07cda5a4ea38",
  measurementId: "G-4MDFGCVS5H",
};
// ─────────────────────────────────────────────────────────────────────────────

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function checkRecruiterAuth() {
import { onAuthChange } from "./firebase.js";

let authChecked = false;

onAuthChange((state)=>{

    if(!authChecked){
        authChecked = true;

        if(!state.isLoggedIn){
            window.location.href="./recruiterlogin.html";
        }

        return;
    }

});
}

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
// ═══════════════════════════════════════════════════════════════════════════════

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
      answerCount:  Array.isArray(d.interviewAnswers) ? d.interviewAnswers.length : 0,
      submittedAt:  d.answersSubmittedAt || null,
      status:       d.interviewStatus || 'pending',
      assignedSets: d.assignedInterviewSets || [],
      // ── NEW: text file fields ─────────────────────────────────────────────
      textFileUrl:     d.textFileUrl     || null,
      textFileContent: d.textFileContent || null,
      textFileName:    d.textFileName    || null,
    });
  });

  return list;
}

export async function getCandidateAnswersById(candidateId) {
  const snap = await getDoc(doc(db, 'candidates', candidateId));
  if (!snap.exists()) throw new Error('Candidate not found');
  const d = snap.data();
  return {
    id:             candidateId,
    email:          d.email             || 'Unknown',
    name:           d.name              || d.email || 'Unknown',
    answers:        d.interviewAnswers  || [],
    fullTranscript: d.fullTranscript    || '',
    transcriptUrl:  d.transcriptUrl     || null,
    submittedAt:    d.answersSubmittedAt || null,
    status:         d.interviewStatus   || 'pending',
    assignedSets:   d.assignedInterviewSets || [],
    // ── NEW ──────────────────────────────────────────────────────────────────
    textFileUrl:     d.textFileUrl     || null,
    textFileContent: d.textFileContent || null,
    textFileName:    d.textFileName    || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT FILE DELIVERY  ← NEW
// Recruiter uploads a .txt file; its content is stored on the candidate doc and
// on the interviewSets mirror so candidate-voice.html can read it without
// needing a Storage download URL (avoids CORS on first load).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a plain-text file and attach it to a candidate.
 *
 * Writes to:
 *   candidates/{candidateId}      → textFileUrl, textFileContent, textFileName
 *   interviewSets/{setId}         → same fields (if setId provided)
 *   Storage: textFiles/{uid}_{ts}.txt
 *
 * @param {File}        file          A File object (must be text/plain or .txt)
 * @param {string}      candidateId   Firestore UID of the target candidate
 * @param {string|null} setId         Optional: the interviewSets doc to also update
 * @returns {Promise<{ textFileUrl: string, textFileContent: string }>}
 */
export async function sendTextFileToCandidate(file, candidateId, setId = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  if (!file)         throw new Error('No file provided');
  if (!candidateId)  throw new Error('No candidateId provided');

  // 1. Read file contents as plain text (client-side)
  const textFileContent = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file, 'UTF-8');
  });

  // 2. Upload to Firebase Storage
  let textFileUrl = null;
  try {
    const sRef = storageRef(
      storage,
      `textFiles/${candidateId}_${Date.now()}.txt`,
    );
    const uploadSnap = await uploadBytes(sRef, file);
    textFileUrl = await getDownloadURL(uploadSnap.ref);
  } catch (e) {
    console.warn('[recruit.js] Text file Storage upload failed:', e.message);
    // Continue — textFileContent alone is enough for TTS playback
  }

  const textFilePayload = {
    textFileUrl:     textFileUrl || null,
    textFileContent,
    textFileName:    file.name,
    textFileSentAt:  serverTimestamp(),
    textFileSentBy:  user.uid,
  };

  // 3. Update candidate doc
  await updateDoc(doc(db, 'candidates', candidateId), textFilePayload)
    .catch(async () => {
      await setDoc(doc(db, 'candidates', candidateId), textFilePayload, { merge: true });
    });

  // 4. Mirror onto interviewSets doc if a setId is provided
  if (setId) {
    await updateDoc(doc(db, 'interviewSets', setId), textFilePayload)
      .catch(() => {}); // non-fatal
  }

  console.log('[recruit.js] ✓ Text file sent to candidate', candidateId);
  return { textFileUrl, textFileContent };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT FILE RETRIEVAL — for candidate side  ← NEW
// candidate-voice.html calls this to get the text content before the interview.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns the text file content sent by the recruiter for a given candidate.
 *
 * Lookup order:
 *   1. candidates/{candidateId}.textFileContent  (fastest, always fresh)
 *   2. interviewSets/{latestSetId}.textFileContent  (fallback)
 *
 * @param {string} candidateId
 * @returns {Promise<{ textFileContent: string, textFileName: string } | null>}
 */
export async function getTextFileForCandidate(candidateId) {
  // 1. Primary: candidate doc
  const candSnap = await getDoc(doc(db, 'candidates', candidateId));
  if (candSnap.exists()) {
    const d = candSnap.data();
    if (d.textFileContent) {
      return {
        textFileContent: d.textFileContent,
        textFileName:    d.textFileName || 'briefing.txt',
      };
    }
  }

  // 2. Fallback: latest assigned interviewSet mirror
  if (candSnap.exists()) {
    const sets = candSnap.data().assignedInterviewSets || [];
    if (sets.length > 0) {
      const setSnap = await getDoc(doc(db, 'interviewSets', sets[sets.length - 1]));
      if (setSnap.exists() && setSnap.data().textFileContent) {
        const d = setSnap.data();
        return {
          textFileContent: d.textFileContent,
          textFileName:    d.textFileName || 'briefing.txt',
        };
      }
    }
  }

  return null; // No text file assigned yet
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

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

  const setRef = await addDoc(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    setData,
  );

  if (candidateId) {
    await setDoc(doc(db, 'interviewSets', setRef.id), {
      ...setData,
      recruiterUid: user.uid,
      setId:        setRef.id,
    });

    await updateDoc(doc(db, 'candidates', candidateId), {
      assignedInterviewSets: arrayUnion(setRef.id),
      interviewStatus:       'invited',
      invitedAt:             serverTimestamp(),
      invitedBy:             user.uid,
      recruiterEmail:        user.email,
    }).catch(async () => {
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
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAssignedQuestionsForCandidate(candidateId) {
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

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVIEW SUBMISSION — CANDIDATE SAVES ANSWERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveInterviewSubmission({
  candidateId,
  candidateEmail,
  answers,
  questions,
  fullTranscript,
  setId,
}) {
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

  // Global submissions collection
  await addDoc(collection(db, 'submissions'), submissionPayload);

  // Update candidate doc
  const candUpdate = {
    interviewAnswers:   answers,
    interviewStatus:    'submitted',
    answersSubmittedAt: serverTimestamp(),
    fullTranscript,
    transcriptUrl:      transcriptUrl || null,
    lastSetId:          setId || null,
  };

  await updateDoc(doc(db, 'candidates', candidateId), candUpdate)
    .catch(async () => {
      await setDoc(doc(db, 'candidates', candidateId), {
        email:        candidateEmail,
        role:         'candidate',
        ...candUpdate,
      }, { merge: true });
    });

  // ── NEW: also update the interviewSets mirror with submission status ────────
  if (setId) {
    await updateDoc(doc(db, 'interviewSets', setId), {
      submissionStatus:   'submitted',
      submittedAt:        serverTimestamp(),
      candidateAnswers:   answers,
      fullTranscript,
      transcriptUrl:      transcriptUrl || null,
    }).catch(() => {}); // non-fatal
  }

  return { transcriptUrl };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER EVALUATION
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
// ── NEW ────────────────────────────────────────────────────────────────────────
window.sendTextFileToCandidate          = sendTextFileToCandidate;
window.getTextFileForCandidate          = getTextFileForCandidate;

// Auto-run auth guard when loaded on recruiter pages
if (!window._skipAutoAuth) checkRecruiterAuth();

console.log('[recruit.js] ✓ loaded — Firebase 11.6.0, all globals registered');