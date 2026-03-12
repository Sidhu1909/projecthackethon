// recruit.js — Firebase/backend integration for recruiter interview management
// Provides question storage, candidate retrieval, evaluation, and auth helpers

import {
  db,
  auth,
  signOutUser,
  onAuthChange,
} from './index.js';

import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// ──────────────────────────────────────────────────────────────
// QUESTION MANAGEMENT
// ──────────────────────────────────────────────────────────────

/**
 * Save interview questions to Firestore
 * @param {string[]} questions
 * @returns {Promise<string>} document id
 */
export async function saveInterviewQuestions(questions, candidateId = null, fileUrl = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Questions must be a non-empty array');
  }

  const data = {
    questions,
    count: questions.length,
    createdAt: serverTimestamp(),
    createdBy: user.email,
    status: 'active',
  };
  if (candidateId) {
    data.assignedTo = candidateId; // record who the recruiter sent it to
  }
  if (fileUrl) {
    data.fileUrl = fileUrl;
  }

  const ref = await addDoc(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    data
  );

  if (candidateId) {
    // also update the candidate document to reference this set
    const candRef = doc(db, 'candidates', candidateId);
    await updateDoc(candRef, {
      assignedInterviewSets: arrayUnion(ref.id)
    });
  }

  return ref.id;
}

/**
 * Retrieve active question sets for current recruiter
 */
export async function getRecruiterQuestionSets() {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const q = query(
    collection(db, 'recruiters', user.uid, 'interviewSets'),
    where('status', '==', 'active')
  );
  const snapshot = await getDocs(q);
  const sets = [];
  snapshot.forEach(d => sets.push({ id: d.id, ...d.data() }));
  return sets;
}

/**
 * Fetch candidates who have submitted answers (prefer backend)
 */
export async function getCandidatesWithAnswers() {
  try {
    const res = await fetch('/api/candidates');
    if (res.ok) {
      const data = await res.json();
      return data.candidates || [];
    }
  } catch (err) {
    console.warn('backend fetch failed', err);
  }

  // fallback to Firestore
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  const candidatesRef = collection(db, 'candidates');
  const q = query(candidatesRef); // return all candidates
  const snapshot = await getDocs(q);
  const list = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    list.push({
      id: docSnap.id,
      email: d.email || 'Unknown',
      answers: d.interviewAnswers || [],
      answerCount: d.interviewAnswers ? d.interviewAnswers.length : 0,
      submittedAt: d.answersSubmittedAt || null,
    });
  });
  return list;
}

/**
 * Get a single candidate's answers by document ID
 */
export async function getCandidateAnswersById(candidateId) {
  try {
    const res = await fetch(`/api/candidates/${candidateId}/answers`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('backend load candidate answers failed', e);
  }

  const docRef = doc(db, 'candidates', candidateId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Candidate not found');
  const d = snap.data();
  return {
    id: candidateId,
    email: d.email || 'Unknown',
    answers: d.interviewAnswers || [],
    submittedAt: d.answersSubmittedAt || null,
  };
}

// ──────────────────────────────────────────────────────────────
// QUESTION ACCESS (for candidates)
// ──────────────────────────────────────────────────────────────

/**
 * Fetch interview question sets that have been assigned to a candidate
 * @param {string} candidateId
 */
export async function getQuestionSetsForCandidate(candidateId) {
  if (!candidateId) throw new Error('candidateId required');
  const candRef = doc(db, 'candidates', candidateId);
  const snap = await getDoc(candRef);
  if (!snap.exists()) return [];
  const data = snap.data();
  const setIds = data.assignedInterviewSets || [];
  if (setIds.length === 0) return [];

  // fetch each set from recruiters collection (since sets are stored under recruiter)
  const sets = [];
  for (const setId of setIds) {
    // we don't know which recruiter; potentially store recruiterId in candidate record
    // for now scan all recruiters (inefficient) or require recruiterId stored as well
    // to simplify, check current user's recruiter sets only (assumes candidate view logged-in as recruiter?)
    // in candidate context, you would implement different API endpoint to return sets.
  }
  return sets;
}

// ──────────────────────────────────────────────────────────────
// ANSWER EVALUATION
// ──────────────────────────────────────────────────────────────

export async function evaluateCandidateAnswers(questions, answers) {
  // try backend evaluation
  try {
    const resp = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions, answers }),
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {
    console.warn('backend evaluation failed', e);
  }

  // fallback to client-side algorithm
  const results = {
    totalQuestions: questions.length,
    totalAnswers: answers.length,
    scores: [],
    overallScore: 0,
    feedback: '',
    timestamp: new Date().toLocaleDateString(),
  };

  for (let i = 0; i < Math.max(questions.length, answers.length); i++) {
    const q = questions[i] || 'N/A';
    const a = answers[i] || '';
    const scoreObj = scoreSingleAnswer(q, a, i + 1);
    results.scores.push(scoreObj);
  }

  if (results.scores.length)
    results.overallScore = Math.round(
      results.scores.reduce((sum, s) => sum + s.score, 0) / results.scores.length
    );

  results.feedback = generateFeedback(results);
  await saveEvaluationToFirebase(questions, answers, results);
  return results;
}

function scoreSingleAnswer(question, answer, num) {
  const score = { questionNumber: num, question, answer, score: 0, details: [] };
  if (!answer.trim()) {
    score.details.push('No answer provided');
    return score;
  }
  const wordCount = answer.trim().split(/\s+/).length;
  const lengthScore = Math.min(100, (wordCount / 50) * 100);
  score.details.push(`Word count: ${wordCount} (${lengthScore.toFixed(0)}%)`);

  const completeness = calculateCompleteness(answer, question);
  score.details.push(`Completeness: ${completeness}%`);

  const relevance = calculateRelevance(answer, question);
  score.details.push(`Relevance: ${relevance}%`);

  score.score = Math.round((lengthScore + completeness + relevance) / 3);
  return score;
}

function calculateCompleteness(answer, question) {
  const indicators = [
    'because','therefore','for example','for instance','specifically',
    'particularly','such as','including','i','we','my','our','experience',
    'project','developed','created','implemented',
  ];
  const lower = answer.toLowerCase();
  const matches = indicators.filter(i => lower.includes(i)).length;
  return Math.min(100,(matches/indicators.length)*100);
}

function calculateRelevance(answer, question) {
  const qwords = question.toLowerCase().split(/\s+/).filter(w => w.length>4);
  if (!qwords.length) return 50;
  const alower = answer.toLowerCase();
  const matched = qwords.filter(w => alower.includes(w)).length;
  return (matched / qwords.length) * 100;
}

function generateFeedback(results) {
  const { overallScore, totalQuestions, totalAnswers } = results;
  let fb = '';
  if (totalAnswers < totalQuestions) {
    fb += `⚠️ Missing ${totalQuestions - totalAnswers} answer(s). `;
  }
  if (overallScore >= 80) fb += `Excellent responses with strong detail and relevance. Score: ${overallScore}/100`;
  else if (overallScore >= 60) fb += `Good responses overall. Score: ${overallScore}/100. Consider more specific examples.`;
  else if (overallScore >= 40) fb += `Average responses. Score: ${overallScore}/100. Candidate may need additional support or clarification.`;
  else fb += `Score: ${overallScore}/100. Responses lack sufficient detail. Further discussion recommended.`;
  return fb;
}

async function saveEvaluationToFirebase(questions, answers, results) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(
      collection(db, 'recruiters', user.uid, 'evaluations'),
      {
        questions, answers,
        overallScore: results.overallScore,
        scores: results.scores,
        feedback: results.feedback,
        createdAt: serverTimestamp(),
        evaluatorEmail: user.email,
      }
    );
  } catch (err) {
    console.error('Error saving evaluation:', err);
  }
}

// ──────────────────────────────────────────────────────────────
// AUTH & PAGE HELPERS
// ──────────────────────────────────────────────────────────────

export function checkRecruiterAuth() {
  onAuthChange(user => {
    if (!user) {
      window.location.href = './recruiterlogin.html';
      return;
    }
    const role = localStorage.getItem('talentBridgeRole');
    if (role !== 'recruiter') {
      window.location.href = './welcome.html';
      return;
    }
  });
}

export async function logoutRecruiter() {
  try {
    await signOutUser();
    localStorage.removeItem('talentBridgeRole');
    localStorage.removeItem('recruiterEmail');
    window.location.href = './welcome.html';
  } catch (err) {
    console.error('Logout error:', err);
    alert('Error logging out: ' + err.message);
  }
}

// expose globals for HTML
window.saveInterviewQuestions = saveInterviewQuestions;
window.evaluateCandidateAnswers = evaluateCandidateAnswers;
window.getRecruiterQuestionSets = getRecruiterQuestionSets;
window.getCandidatesWithAnswers = getCandidatesWithAnswers;
window.getCandidateAnswersById = getCandidateAnswersById;
window.checkRecruiterAuth = checkRecruiterAuth;
window.logoutRecruiter = logoutRecruiter;

// run boot logic
checkRecruiterAuth();

console.log('📋 Recruit module loaded');
