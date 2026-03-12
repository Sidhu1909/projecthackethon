// recruit.js — Firebase integration for recruiter interview management
// handles saving interview questions, evaluating candidate answers, and auth checks

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
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// ──────────────────────────────────────────────────────────────
// QUESTION MANAGEMENT (local firebase still available for saving, but fetching candidates uses backend)
// ──────────────────────────────────────────────────────────────

/**
 * Save interview questions to Firebase Firestore
 * @param {string[]} questions - Array of question strings
 * @returns {Promise<string>} Document ID if successful
 */
export async function saveInterviewQuestions(questions) {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }

    // Validate input
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Questions must be a non-empty array');
    }

    // Save as a single document with questions array
    const questionSetRef = await addDoc(
      collection(db, 'recruiters', user.uid, 'interviewSets'),
      {
        questions: questions,
        count: questions.length,
        createdAt: serverTimestamp(),
        createdBy: user.email,
        status: 'active',
      }
    );

    console.log('Questions saved with ID:', questionSetRef.id);
    return questionSetRef.id;

  } catch (err) {
    console.error('Error saving questions to Firebase:', err);
    throw err;
  }
}

/**
 * Get all candidates who have submitted interview answers
 * @returns {Promise<Array>} Array of candidates with their answer counts
 */
export async function getCandidatesWithAnswers() {
  // prefer backend API for candidate listing; fallback to firestore
  try {
    const res = await fetch('/api/candidates');
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    return data.candidates || [];
  } catch (err) {
    console.warn('backend fetch failed, falling back to firestore', err);
  }

  // firestore fallback
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    const candidatesRef = collection(db, 'candidates');
    const q = query(candidatesRef, where('interviewAnswers', '!=', null));
    const snapshot = await getDocs(q);
    const candidates = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.interviewAnswers && data.interviewAnswers.length > 0) {
        candidates.push({
          id: docSnap.id,
          email: data.email || 'Unknown',
          answers: data.interviewAnswers || [],
          answerCount: (data.interviewAnswers || []).length,
          submittedAt: data.answersSubmittedAt || null,
        });
      }
    });
    return candidates;
  } catch (err) {
    console.error('Error fetching candidates with answers (firestore):', err);
    return [];
  }
}

/**
 * Get candidate's interview answers by ID
 * @param {string} candidateId - Candidate document ID
 * @returns {Promise<Object>} Candidate data with answers
 */
export async function getCandidateAnswersById(candidateId) {
  try {
    const docRef = doc(db, 'candidates', candidateId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Candidate not found');
    }

    const data = docSnap.data();
    return {
      id: candidateId,
      email: data.email || 'Unknown',
      answers: data.interviewAnswers || [],
      submittedAt: data.answersSubmittedAt || null,
    };

  } catch (err) {
    console.error('Error fetching candidate answers:', err);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// ANSWER EVALUATION
// ──────────────────────────────────────────────────────────────

/**
 * Evaluate candidate answers against interview questions
 * Uses basic NLP-like scoring: word count, keyword presence, answer completeness
 * @param {string[]} questions - Array of interview questions
 * @param {string[]} answers - Array of candidate answers
 * @returns {Promise<Object>} Evaluation result with scores and feedback
 */
export async function evaluateCandidateAnswers(questions, answers) {
  try {
    // Validate inputs
    if (!Array.isArray(questions) || !Array.isArray(answers)) {
      throw new Error('Questions and answers must be arrays');
    }

    if (questions.length === 0) {
      throw new Error('No questions provided');
    }

    const results = {
      totalQuestions: questions.length,
      totalAnswers: answers.length,
      scores: [],
      overallScore: 0,
      feedback: '',
      timestamp: new Date().toLocaleDateString(),
    };

    // Score each answer
    for (let i = 0; i < Math.max(questions.length, answers.length); i++) {
      const question = questions[i] || 'N/A';
      const answer = answers[i] || '';

      const scoreObj = scoreSingleAnswer(question, answer, i + 1);
      results.scores.push(scoreObj);
    }

    // Calculate overall score (average of all answer scores)
    if (results.scores.length > 0) {
      results.overallScore = Math.round(
        results.scores.reduce((sum, s) => sum + s.score, 0) / results.scores.length
      );
    }

    // Generate feedback
    results.feedback = generateFeedback(results);

    // Save to Firebase
    await saveEvaluationToFirebase(questions, answers, results);

    return results;

  } catch (err) {
    console.error('Error evaluating answers:', err);
    throw err;
  }
}

/**
 * Score a single answer based on question and response quality
 * @param {string} question - Interview question
 * @param {string} answer - Candidate's answer
 * @param {number} questionNum - Question number
 * @returns {Object} Score object with details
 */
function scoreSingleAnswer(question, answer, questionNum) {
  const score = {
    questionNumber: questionNum,
    question: question,
    answer: answer,
    score: 0,
    details: [],
  };

  // Check if answer exists
  if (!answer || answer.trim().length === 0) {
    score.score = 0;
    score.details.push('No answer provided');
    return score;
  }

  // Score based on answer length (minimum expected ~30 words for meaningful answer)
  const wordCount = answer.trim().split(/\s+/).length;
  const lengthScore = Math.min(100, (wordCount / 50) * 100);

  score.details.push(`Word count: ${wordCount} (${lengthScore.toFixed(0)}%)`);

  // Score based on answer completeness (presence of action words, details)
  const completenessScore = calculateCompleteness(answer, question);
  score.details.push(`Completeness: ${completenessScore}%`);

  // Score based on relevance keywords
  const relevanceScore = calculateRelevance(answer, question);
  score.details.push(`Relevance: ${relevanceScore}%`);

  // Average the three scores
  score.score = Math.round((lengthScore + completenessScore + relevanceScore) / 3);

  return score;
}

/**
 * Calculate answer completeness score
 * Looks for detailed descriptions, examples, or explanations
 */
function calculateCompleteness(answer, question) {
  const detailIndicators = [
    'because', 'therefore', 'for example', 'for instance',
    'specifically', 'particularly', 'such as', 'including',
    'i', 'we', 'my', 'our', 'experience', 'experienced',
    'project', 'developed', 'created', 'implemented',
  ];

  const lowerAnswer = answer.toLowerCase();
  const matchCount = detailIndicators.filter(indicator =>
    lowerAnswer.includes(indicator)
  ).length;

  // More detail indicators = higher completeness score
  return Math.min(100, (matchCount / detailIndicators.length) * 100);
}

/**
 * Calculate answer relevance to the question
 * Uses simple keyword matching and sentence structure analysis
 */
function calculateRelevance(answer, question) {
  const questionWords = question
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4); // Ignore short words

  if (questionWords.length === 0) {
    return 50; // Default relevance if can't parse question
  }

  const answerLower = answer.toLowerCase();
  const matchedWords = questionWords.filter(word =>
    answerLower.includes(word)
  ).length;

  // Calculate relevance based on keyword match percentage
  return (matchedWords / questionWords.length) * 100;
}

/**
 * Generate human-readable feedback based on evaluation results
 */
function generateFeedback(results) {
  const { overallScore, totalQuestions, totalAnswers } = results;

  let feedback = '';

  // Check for missing answers
  if (totalAnswers < totalQuestions) {
    feedback += `⚠️ Missing ${totalQuestions - totalAnswers} answer(s). `;
  }

  // Overall assessment
  if (overallScore >= 80) {
    feedback += `Excellent responses with strong detail and relevance. Score: ${overallScore}/100`;
  } else if (overallScore >= 60) {
    feedback += `Good responses overall. Score: ${overallScore}/100. `;
    feedback += 'Consider asking for more specific examples.';
  } else if (overallScore >= 40) {
    feedback += `Average responses. Score: ${overallScore}/100. `;
    feedback += 'Candidate may need additional support or clarification.';
  } else {
    feedback += `Score: ${overallScore}/100. `;
    feedback += 'Responses lack sufficient detail. Further discussion recommended.';
  }

  return feedback;
}

/**
 * Save evaluation results to Firebase for record-keeping
 */
async function saveEvaluationToFirebase(questions, answers, results) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.warn('User not authenticated, skipping Firebase save');
      return;
    }

    // Save evaluation record
    await addDoc(
      collection(db, 'recruiters', user.uid, 'evaluations'),
      {
        questions: questions,
        answers: answers,
        overallScore: results.overallScore,
        scores: results.scores,
        feedback: results.feedback,
        createdAt: serverTimestamp(),
        evaluatorEmail: user.email,
      }
    );

    console.log('Evaluation saved to Firebase');

  } catch (err) {
    console.error('Error saving evaluation to Firebase:', err);
    // Don't throw - evaluation still succeeded, just not saved to DB
  }
}

// ──────────────────────────────────────────────────────────────
// AUTHENTICATION & PAGE MANAGEMENT
// ──────────────────────────────────────────────────────────────

/**
 * Check if user is authenticated as recruiter
 * If not, redirect to login
 */
export function checkRecruiterAuth() {
  onAuthChange(user => {
    if (!user) {
      console.log('No user authenticated, redirecting to login');
      window.location.href = './recruiterlogin.html';
      return;
    }

    const role = localStorage.getItem('talentBridgeRole');
    if (role !== 'recruiter') {
      console.log('User is not a recruiter, redirecting');
      window.location.href = './welcome.html';
      return;
    }

    console.log('Recruiter authenticated:', user.email);
  });
}

/**
 * Logout the current recruiter user
 */
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

// ──────────────────────────────────────────────────────────────
// EXPOSE TO GLOBAL SCOPE FOR HTML ACCESS
// ──────────────────────────────────────────────────────────────

window.saveInterviewQuestions = saveInterviewQuestions;
window.evaluateCandidateAnswers = evaluateCandidateAnswers;
window.checkRecruiterAuth = checkRecruiterAuth;
window.logoutRecruiter = logoutRecruiter;
window.getRecruiterQuestionSets = getRecruiterQuestionSets;
window.getCandidatesWithAnswers = getCandidatesWithAnswers;
window.getCandidateAnswersById = getCandidateAnswersById;

// Initialize authentication check on page load
checkRecruiterAuth();

console.log('📋 Recruit module loaded - interview management ready');
