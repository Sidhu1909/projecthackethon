// ── candidate-voice.js ────────────────────────────────────────────────────────
// Firebase + interview logic for candidate-voice.html.
//
// Responsibilities:
//   • Auth guard   — reads titanRole/titanUID/titanEmail from localStorage
//                    OR listens to onAuthStateChanged for a live Firebase session
//   • Question fetch — reads interviewSets/{setId} mirror written by recruit.js
//   • Briefing fetch — reads textFileContent sent by recruiter, reads it aloud
//   • Speech Recognition — wake-word + per-question answer capture
//   • Text-to-Speech    — reads briefing + each question aloud via Web Speech API
//   • Submission        — delegates all Firestore/Storage writes to
//                         window.saveInterviewSubmission (exported by recruit.js)
//
// Schema contracts (must match candlogin.js + recruit.js):
//   candidates/{uid}.assignedInterviewSets[]  → array of set IDs
//   candidates/{uid}.textFileContent           → briefing text sent by recruiter
//   candidates/{uid}.textFileName              → original filename
//   interviewSets/{setId}.questions[]          → string array of questions
//   interviewSets/{setId}.textFileContent      → briefing mirror
//   saveInterviewSubmission writes:
//     candidates/{uid}.interviewAnswers[]
//     candidates/{uid}.interviewStatus = 'submitted'
//     candidates/{uid}.answersSubmittedAt
//
// Firebase SDK: 11.6.0  (matches recruit.js and candlogin.js)
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp }      from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
    getFirestore,
    getDoc, getDocs, doc, collection,
    query, where, orderBy,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ─── Firebase config ──────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyD3c6gMQt00siR70-B93qBjVqYQAjrM3W4",
    authDomain:        "titan-fde30.firebaseapp.com",
    projectId:         "titan-fde30",
    storageBucket:     "titan-fde30.firebasestorage.app",
    messagingSenderId: "545954155049",
    appId:             "1:545954155049:web:59e785904b07cda5a4ea38",
    measurementId:     "G-4MDFGCVS5H",
};
// ─────────────────────────────────────────────────────────────────────────────

// Named instance — avoids clashing with recruit.js default app instance.
let app, auth, db;
let firebaseReady = false;

try {
    app  = initializeApp(firebaseConfig, "candidate-voice");
    auth = getAuth(app);
    db   = getFirestore(app);
    firebaseReady = true;
    console.log("[candidate-voice.js] Firebase initialised ✓");
} catch (e) {
    console.warn("[candidate-voice.js] Firebase init failed — demo mode.", e.message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

let questions            = [];   // string[] — assigned by recruiter
let perQuestionAnswers   = [];   // string[] — one slot per question
let fullTranscript       = "";   // raw concatenated transcript
let interviewStarted     = false;
let currentQuestionIndex = -1;
let silenceTimeout       = null;
let wakeRecognition      = null;
let interviewRecognition = null;
let assignedSetId        = null;
let candidateId          = null;
let candidateEmail       = "";

// ── NEW: briefing text file ───────────────────────────────────────────────────
let briefingContent  = null;   // string — plain text sent by recruiter
let briefingFileName = "";     // original filename e.g. "job-spec.txt"

const SILENCE_THRESHOLD = 6000; // ms of silence before advancing to next question

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ═══════════════════════════════════════════════════════════════════════════════
// DOM REFS  (resolved after DOMContentLoaded)
// ═══════════════════════════════════════════════════════════════════════════════

let statusBadge, statusText, micViz, transcriptEl, questionCard, questionNum,
    questionEl, progressWrap, progressFill, progressLbl, startBtn, finishBtn,
    retryBtn, fetchBanner, candStrip, guard, mainContent;

// ── NEW briefing DOM refs ─────────────────────────────────────────────────────
let briefingCard, briefingBody, briefingFileNm, briefingReading, briefingDone;

function resolveDOM() {
    statusBadge  = document.getElementById('status-badge');
    statusText   = document.getElementById('status-text');
    micViz       = document.getElementById('mic-visualizer');
    transcriptEl = document.getElementById('live-transcript');
    questionCard = document.getElementById('question-card');
    questionNum  = document.getElementById('question-num');
    questionEl   = document.getElementById('current-question');
    progressWrap = document.getElementById('progress-wrap');
    progressFill = document.getElementById('progress-fill');
    progressLbl  = document.getElementById('progress-label');
    startBtn     = document.getElementById('start-btn');
    finishBtn    = document.getElementById('finish-btn');
    retryBtn     = document.getElementById('retry-btn');
    fetchBanner  = document.getElementById('fetchBanner');
    candStrip    = document.getElementById('candStrip');
    guard        = document.getElementById('auth-guard');
    mainContent  = document.getElementById('main-content');

    // Briefing elements (may be absent in older HTML — guard with ?.)
    briefingCard    = document.getElementById('briefingCard');
    briefingBody    = document.getElementById('briefingBody');
    briefingFileNm  = document.getElementById('briefingFileName');
    briefingReading = document.getElementById('briefingReading');
    briefingDone    = document.getElementById('briefingDone');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function showToast(msg, type = 'info') {
    const t    = document.getElementById('toast');
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '—';
    t.className = `toast ${type}`;
    t.innerHTML = `${icon} ${msg}`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}

function setStatus(text, mode = 'idle') {
    if (!statusText) return;
    statusText.textContent = text;
    statusBadge.classList.remove('active', 'loading', 'briefing');
    if (mode === 'active')   statusBadge.classList.add('active');
    if (mode === 'loading')  statusBadge.classList.add('loading');
    if (mode === 'briefing') statusBadge.classList.add('briefing');
}

function showFetchBanner(msg, cls = '') {
    fetchBanner.textContent = msg;
    fetchBanner.className   = `fetch-banner show ${cls}`;
}
function hideFetchBanner() {
    fetchBanner.className = 'fetch-banner';
}

function updateProgress() {
    const done  = Math.max(0, currentQuestionIndex);
    const total = questions.length || 1;
    progressFill.style.width = `${(done / total) * 100}%`;
    progressLbl.textContent  = `${done} / ${total}`;
}

// ── NEW: render the briefing card ─────────────────────────────────────────────
function showBriefingCard() {
    if (!briefingCard || !briefingContent) return;
    if (briefingBody)   briefingBody.textContent   = briefingContent;
    if (briefingFileNm) briefingFileNm.textContent = briefingFileName ? `· ${briefingFileName}` : '';
    briefingCard.classList.add('show');
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════════════════════════════════════════

function revealPage() {
    guard.style.display       = 'none';
    mainContent.style.display = '';
    candStrip.style.display   = 'block';
    document.getElementById('candEmail').textContent = candidateEmail || 'candidate';
    startStarfield();
    fetchAssignedQuestions();
}

function bootAuth() {
    if (firebaseReady) {
        onAuthStateChanged(auth, user => {
            if (user) {
                candidateId    = user.uid;
                candidateEmail = user.email || '';
                localStorage.setItem('titanRole',  'candidate');
                localStorage.setItem('titanEmail', candidateEmail);
                localStorage.setItem('titanUID',   candidateId);
                revealPage();
            } else {
                candidateEmail = localStorage.getItem('titanEmail') || '';
                candidateId    = localStorage.getItem('titanUID')   ||
                                 localStorage.getItem('titanEmail') || 'demo';
                if (localStorage.getItem('titanRole') === 'candidate') {
                    revealPage();
                } else {
                    guard.style.display = 'flex';
                }
            }
        });
    } else {
        candidateEmail = localStorage.getItem('titanEmail') || 'demo@talentbridge.ai';
        candidateId    = localStorage.getItem('titanUID')   || candidateEmail || 'demo';
        if (localStorage.getItem('titanRole') === 'candidate') {
            revealPage();
        } else {
            guard.style.display = 'flex';
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION FETCH  (+ briefing text file)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAssignedQuestions() {
    retryBtn.style.display = 'none';
    micViz.classList.add('loading-q');
    setStatus('FETCHING QUESTIONS…', 'loading');
    showFetchBanner('⏳ Contacting Firebase for your assigned question set…');
    questionCard.classList.add('waiting');
    questionEl.innerHTML = '<span class="spin"></span> Fetching your assigned questions…';

    if (!firebaseReady || !db) {
        useDemoQuestions();
        return;
    }

    try {
        let found = null;

        // ── 1. Candidate doc → assignedInterviewSets[] → interviewSets mirror ──
        const candSnap = await getDoc(doc(db, "candidates", candidateId));
        if (candSnap.exists()) {
            const data         = candSnap.data();
            const assignedSets = data.assignedInterviewSets || [];

            // ── NEW: grab briefing from candidate doc first ───────────────────
            if (data.textFileContent) {
                briefingContent  = data.textFileContent;
                briefingFileName = data.textFileName || 'briefing.txt';
            }

            if (assignedSets.length > 0) {
                const latestSetId = assignedSets[assignedSets.length - 1];
                const setSnap     = await getDoc(doc(db, "interviewSets", latestSetId));
                if (setSnap.exists() && setSnap.data().questions?.length) {
                    found = { questions: setSnap.data().questions, setId: latestSetId, fileUrl: setSnap.data().fileUrl || null };
                    // ── NEW: fallback to set-level briefing if not on cand doc ─
                    if (!briefingContent && setSnap.data().textFileContent) {
                        briefingContent  = setSnap.data().textFileContent;
                        briefingFileName = setSnap.data().textFileName || 'briefing.txt';
                    }
                }
            }
        }

        // ── 2. Fallback: query interviewSets mirror by candidateId field ─────
        if (!found) {
            const q    = query(
                collection(db, "interviewSets"),
                where("candidateId", "==", candidateId),
                orderBy("createdAt", "desc"),
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
                const latest = snap.docs[0];
                if (latest.data().questions?.length) {
                    found = { questions: latest.data().questions, setId: latest.id, fileUrl: latest.data().fileUrl || null };
                    if (!briefingContent && latest.data().textFileContent) {
                        briefingContent  = latest.data().textFileContent;
                        briefingFileName = latest.data().textFileName || 'briefing.txt';
                    }
                }
            }
        }

        micViz.classList.remove('loading-q');

        if (found) {
            questions          = found.questions;
            assignedSetId      = found.setId;
            perQuestionAnswers = new Array(questions.length).fill('');

            // Legacy fileUrl download link support
            if (found.fileUrl) {
                const existing = document.getElementById('attached-file-link');
                if (!existing) {
                    const link    = document.createElement('a');
                    link.id       = 'attached-file-link';
                    link.href     = found.fileUrl;
                    link.target   = '_blank';
                    link.textContent = 'Download attached file';
                    link.style.cssText = 'display:block;margin:0.75rem 0;color:#7090c9;font-size:0.8rem;letter-spacing:1px;';
                    questionCard.parentNode.insertBefore(link, questionCard.nextSibling);
                } else {
                    existing.href = found.fileUrl;
                }
            }

            // ── NEW: show briefing card if text file was sent ─────────────────
            if (briefingContent) {
                showBriefingCard();
            }

            showFetchBanner(`✓ ${questions.length} questions assigned by your recruiter`, 'ok');
            setTimeout(hideFetchBanner, 4000);
            setStatus('READY — SAY "START INTERVIEW"', 'idle');
            questionEl.textContent = briefingContent
                ? 'Your recruiter briefing is shown above. It will be read aloud when you start.'
                : 'Say "Start Interview" or press the button to begin.';
            questionCard.classList.add('waiting');
            startBtn.disabled = false;
            startWakeWordListening();
        } else {
            showFetchBanner('⚠️ No question set assigned yet. Please wait for your recruiter.', 'err');
            setStatus('AWAITING QUESTIONS', 'idle');
            questionEl.textContent = 'Your recruiter has not assigned questions yet. Check back shortly.';
            retryBtn.style.display = 'inline-block';
        }
    } catch (err) {
        console.error("[candidate-voice.js] fetchAssignedQuestions error:", err);
        micViz.classList.remove('loading-q');
        showFetchBanner('⚠️ Could not load questions — using defaults.', 'err');
        useDemoQuestions();
    }
}

function useDemoQuestions() {
    questions = [
        "Please introduce yourself and walk us through your professional background.",
        "What are your key technical skills and areas of expertise?",
        "Why do you want to join our company, and what excites you about this role?",
        "Describe a significant challenge you faced at work and how you resolved it.",
        "Where do you see your career heading over the next five years?",
        "Do you have any questions for the interviewer?",
    ];
    perQuestionAnswers = new Array(questions.length).fill('');
    assignedSetId      = null;
    micViz.classList.remove('loading-q');
    showFetchBanner('ℹ️ Using default questions (demo mode)', '');
    setTimeout(hideFetchBanner, 4000);
    setStatus('READY — SAY "START INTERVIEW"', 'idle');
    questionEl.textContent = 'Say "Start Interview" or press the button to begin.';
    questionCard.classList.add('waiting');
    startBtn.disabled = false;
    startWakeWordListening();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Speaks `text` via the Web Speech API and calls `onEnd` when done.
 * Dynamic timeout scales with word count so long briefings never cut off.
 */
function speak(text, onEnd) {
    if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }

    const utt   = new SpeechSynthesisUtterance(text);
    utt.rate    = 0.9;
    utt.pitch   = 0.85;
    utt.volume  = 1;

    const voices = speechSynthesis.getVoices();
    const voice  = voices.find(v => /Samantha|Karen|Daniel|Google UK|Google US/i.test(v.name))
                || voices.find(v => v.lang.startsWith('en'));
    if (voice) utt.voice = voice;

    // Dynamic timeout: ~0.55 s per word + 5 s buffer, minimum 15 s
    const wordCount    = text.trim().split(/\s+/).length;
    const safetyMs     = Math.max(15000, wordCount * 550 + 5000);
    const safetyTimer  = setTimeout(() => { if (onEnd) onEnd(); }, safetyMs);

    utt.onend   = () => { clearTimeout(safetyTimer); if (onEnd) onEnd(); };
    utt.onerror = () => { clearTimeout(safetyTimer); if (onEnd) onEnd(); };

    speechSynthesis.cancel();
    speechSynthesis.speak(utt);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SILENCE TIMER
// ═══════════════════════════════════════════════════════════════════════════════

function resetSilenceTimer() {
    if (silenceTimeout) clearTimeout(silenceTimeout);
    silenceTimeout = setTimeout(() => {
        if (interviewStarted) nextQuestion();
    }, SILENCE_THRESHOLD);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAKE-WORD LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

function startWakeWordListening() {
    if (!SR) { setStatus('BROWSER UNSUPPORTED'); return; }
    setStatus('SAY "START INTERVIEW"', 'idle');

    function startWake() {
        wakeRecognition                = new SR();
        wakeRecognition.lang           = 'en-US';
        wakeRecognition.continuous     = false;
        wakeRecognition.interimResults = true;

        wakeRecognition.onresult = e => {
            let txt = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                txt += e.results[i][0].transcript;
            }
            if (txt.toLowerCase().includes('start interview')) {
                wakeRecognition.abort();
                startInterview();
            }
        };

        wakeRecognition.onend   = () => { if (!interviewStarted) setTimeout(startWake, 200); };
        wakeRecognition.onerror = () => { if (!interviewStarted) setTimeout(startWake, 300); };

        try { wakeRecognition.start(); } catch (e) {}
    }

    startWake();
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: READ BRIEFING ALOUD
// Plays intro + full briefing text via TTS, updates briefing card UI,
// then calls onDone to hand off to the interview questions.
// ═══════════════════════════════════════════════════════════════════════════════

function readBriefingAloud(onDone) {
    if (!briefingContent) { onDone(); return; }

    // Switch mic icon and status while reading briefing
    micViz.classList.remove('active');
    micViz.classList.add('briefing');
    const micIcon = document.getElementById('mic-icon');
    if (micIcon) micIcon.textContent = '📋';
    setStatus('READING BRIEFING…', 'briefing');

    if (briefingReading) briefingReading.style.display = 'block';
    if (briefingDone)    briefingDone.style.display    = 'none';

    const intro = 'Your recruiter has sent the following briefing. Please listen carefully.';

    speak(intro, () => {
        speak(briefingContent, () => {
            // Mark briefing as done in the UI
            if (briefingReading) briefingReading.style.display = 'none';
            if (briefingDone)    briefingDone.style.display    = 'block';

            // Restore mic to active state
            micViz.classList.remove('briefing');
            micViz.classList.add('active');
            if (micIcon) micIcon.textContent = '🎤';
            setStatus('INTERVIEW IN PROGRESS', 'active');

            // Short pause before questions begin
            setTimeout(onDone, 1500);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVIEW FLOW
// ═══════════════════════════════════════════════════════════════════════════════

function startInterview() {
    if (interviewStarted || questions.length === 0) return;
    interviewStarted = true;

    if (wakeRecognition) { try { wakeRecognition.abort(); } catch (e) {} }

    fullTranscript = [
        '=== TALENTBRIDGE VOICE INTERVIEW ===',
        `Candidate:     ${candidateEmail}`,
        `Date:          ${new Date().toISOString()}`,
        `Set ID:        ${assignedSetId || 'N/A'}`,
        `Briefing file: ${briefingFileName || 'none'}`,
        '',
    ].join('\n');

    micViz.classList.add('active');
    setStatus('INTERVIEW IN PROGRESS', 'active');
    startBtn.style.display     = 'none';
    finishBtn.style.display    = 'inline-block';
    retryBtn.style.display     = 'none';
    progressWrap.style.display = '';
    questionCard.classList.remove('waiting');
    hideFetchBanner();

    // ── NEW: read briefing first (if present), then begin questions ──────────
    const beginQuestions = () => {
        speak(
            `Welcome to TalentBridge. Your recruiter has assigned ${questions.length} question${questions.length !== 1 ? 's' : ''} for today's interview. ` +
            `Please answer each question clearly. I will move to the next question after a brief pause. Let's begin.`,
            () => {
                currentQuestionIndex = -1;
                nextQuestion();
            },
        );
    };

    if (briefingContent) {
        micViz.classList.remove('active'); // pause gold pulse during briefing TTS
        readBriefingAloud(beginQuestions);
    } else {
        beginQuestions();
    }
}

function nextQuestion() {
    currentQuestionIndex++;
    updateProgress();

    if (currentQuestionIndex >= questions.length) {
        finishInterview();
        return;
    }

    if (interviewRecognition) { try { interviewRecognition.stop(); } catch (e) {} }

    const q = questions[currentQuestionIndex];
    questionNum.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
    questionEl.textContent  = q;

    fullTranscript += `\nQuestion ${currentQuestionIndex + 1}: ${q}\nAnswer: `;
    perQuestionAnswers[currentQuestionIndex] = '';

    speak(q, () => startAnswerListening());
}

// ── Answer listening ──────────────────────────────────────────────────────────

function startAnswerListening() {
    if (!SR) return;
    setStatus(`LISTENING — Q${currentQuestionIndex + 1}`, 'active');

    const qIdx = currentQuestionIndex;

    function startRec() {
        interviewRecognition                = new SR();
        interviewRecognition.lang           = 'en-US';
        interviewRecognition.continuous     = true;
        interviewRecognition.interimResults = true;

        interviewRecognition.onresult = e => {
            let interim = '';
            let final   = '';

            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) final   += e.results[i][0].transcript + ' ';
                else                      interim  += e.results[i][0].transcript;
            }

            if (final) {
                fullTranscript           += final;
                perQuestionAnswers[qIdx]  = (perQuestionAnswers[qIdx] || '') + final;
            }

            transcriptEl.textContent = ((perQuestionAnswers[qIdx] || '') + interim).trim();
            transcriptEl.scrollTop   = transcriptEl.scrollHeight;

            resetSilenceTimer();
        };

        interviewRecognition.onend = () => {
            if (interviewStarted && currentQuestionIndex < questions.length) {
                setTimeout(startRec, 150);
            }
        };

        interviewRecognition.onerror = e => {
            if (e.error !== 'aborted' && interviewStarted) {
                setTimeout(startRec, 250);
            }
        };

        try { interviewRecognition.start(); } catch (e) {}
    }

    startRec();
    resetSilenceTimer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════════

async function finishInterview() {
    if (!interviewStarted) return;
    interviewStarted = false;

    if (silenceTimeout)       clearTimeout(silenceTimeout);
    if (interviewRecognition) { try { interviewRecognition.stop(); } catch (e) {} }
    if (wakeRecognition)      { try { wakeRecognition.abort();     } catch (e) {} }

    micViz.classList.remove('active');
    setStatus('SAVING…', 'loading');
    finishBtn.style.display = 'none';

    fullTranscript += `\n\n=== END OF INTERVIEW ===\nCompleted: ${new Date().toISOString()}`;

    const cleanAnswers = perQuestionAnswers.map(a => (a || '').trim());

    // Race guard: recruit.js loads as a separate module — wait for globals
    let attempts = 0;
    while (!window.saveInterviewSubmission && attempts < 20) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
    }

    if (window.saveInterviewSubmission) {
        try {
            setStatus('UPLOADING…', 'loading');
            showToast('Saving your interview…', 'info');

            await window.saveInterviewSubmission({
                candidateId,
                candidateEmail,
                answers:       cleanAnswers,
                questions,
                fullTranscript,
                setId: assignedSetId || null,
            });

            showToast('Interview saved & sent to recruiter!', 'success');
            speak(
                "Thank you. Your interview has been successfully recorded and sent to your recruiter.",
                showCompletion,
            );
        } catch (err) {
            console.error("[candidate-voice.js] saveInterviewSubmission error:", err);
            showToast('Upload failed — saving locally.', 'error');
            downloadLocally();
            speak("Thank you. Your interview has been completed.", showCompletion);
        }
    } else {
        showToast('Demo mode — downloading transcript.', 'info');
        downloadLocally();
        speak("Thank you. Your interview has been completed.", showCompletion);
    }
}

function downloadLocally() {
    const blob = new Blob([fullTranscript], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `interview_${candidateId}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showCompletion() {
    document.getElementById('interview-ui').style.display = 'none';
    if (briefingCard) briefingCard.style.display = 'none';
    document.getElementById('completion-screen').classList.add('show');
    setStatus('COMPLETED', 'idle');
    if (progressFill) progressFill.style.width = '100%';
    if (progressLbl)  progressLbl.textContent   = `${questions.length} / ${questions.length}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARFIELD
// ═══════════════════════════════════════════════════════════════════════════════

function startStarfield() {
    const canvas = document.getElementById('starCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let stars  = [];

    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function initStars() {
        stars = [];
        const n = Math.floor((canvas.width * canvas.height) / 5000);
        for (let i = 0; i < n; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: Math.random() * 0.8 + 0.1,
                o: Math.random() * 0.6 + 0.1,
                s: Math.random() * 0.008 + 0.002,
                p: Math.random() * Math.PI * 2,
            });
        }
    }

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        frame++;
        for (const s of stars) {
            const opacity = s.o * (0.4 + 0.6 * Math.sin(frame * s.s + s.p));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(197,160,89,${opacity})`;
            ctx.fill();
        }
        requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => { resize(); initStars(); });
    resize();
    initStars();
    draw();
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL EXPOSURE
// ═══════════════════════════════════════════════════════════════════════════════

window.startInterview         = startInterview;
window.finishInterview        = finishInterview;
window.fetchAssignedQuestions = fetchAssignedQuestions;

// ═══════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUT  — Space bar starts the interview
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !interviewStarted && e.target === document.body) {
        e.preventDefault();
        startInterview();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════════

resolveDOM();
bootAuth();

console.log('[candidate-voice.js] ✓ loaded — Firebase 11.6.0');