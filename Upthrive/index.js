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

// ============================================
// VOICE AUTHENTICATION — For Blind Candidates
// ============================================

// Initialize Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

// Voice data store (in production, use Firestore)
const voiceProfiles = new Map();

// ── Helper: Record Voice Sample ──────────────
export async function recordVoiceSample(duration = 5000) {
  return new Promise((resolve, reject) => {
    try {
      // Audio feedback
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          const mediaRecorder = new MediaRecorder(stream);
          const audioChunks = [];
          
          // Play start sound
          speakText("Recording voice sample. Please speak clearly.");
          
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
          
          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            speakText("Recording complete.");
            
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
            
            // Convert to base64 for storage
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve({
                voiceData: reader.result,
                audioUrl: audioUrl,
                timestamp: Date.now(),
              });
            };
            reader.readAsDataURL(audioBlob);
          };
          
          mediaRecorder.start();
          
          // Stop recording after specified duration
          setTimeout(() => {
            mediaRecorder.stop();
          }, duration);
          
        })
        .catch((error) => {
          console.error("Microphone access error:", error);
          speakText("Error accessing microphone. Please enable microphone permissions.");
          reject({ error: error.message });
        });
    } catch (error) {
      console.error("Recording error:", error);
      reject({ error: error.message });
    }
  });
}

// ── Helper: Text-to-Speech (Accessibility) ──
export function speakText(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

// ── Helper: Voice Recognition (Speech-to-Text) ──
export function startVoiceListener(language = 'en-US') {
  return new Promise((resolve, reject) => {
    recognition.language = language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    let transcript = '';
    
    recognition.onstart = () => {
      speakText("Listening...");
    };
    
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
    };
    
    recognition.onerror = (event) => {
      console.error("Voice recognition error:", event.error);
      speakText(`Error: ${event.error}`);
      reject({ error: event.error });
    };
    
    recognition.onend = () => {
      speakText("Processing voice input.");
      resolve({ transcript: transcript.trim() });
    };
    
    recognition.start();
  });
}

// ── Enroll Candidate Voice (First Time Setup) ──
export async function enrollCandidateVoice(email, userId) {
  try {
    // Record 3 voice samples for better recognition accuracy
    speakText("Voice enrollment starting. You will record 3 voice samples.");
    
    const samples = [];
    for (let i = 1; i <= 3; i++) {
      speakText(`Recording sample ${i} of 3. Please say: I am ready for my interview.`);
      
      const sample = await recordVoiceSample(3000);
      samples.push(sample.voiceData);
      
      if (i < 3) {
        speakText("Sample recorded. Please prepare for the next sample.");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Create voice profile
    const voiceProfile = {
      userId: userId,
      email: email,
      samples: samples,
      enrollmentDate: new Date(),
      isVerified: true,
      enrollmentPhrase: "I am ready for my interview",
    };
    
    // Store locally and in Firestore
    voiceProfiles.set(email, voiceProfile);
    
    // Save to Firestore
    try {
      const voiceRef = collection(db, 'voiceProfiles');
      await setDoc(doc(db, 'voiceProfiles', userId), {
        email: email,
        userId: userId,
        enrollmentDate: new Date(),
        enrollmentPhrase: "I am ready for my interview",
        sampleCount: samples.length,
        isActive: true,
      });
    } catch (firestoreError) {
      console.warn("Firestore save warning:", firestoreError);
    }
    
    speakText("Voice enrollment successful. You can now use voice authentication to login.");
    console.log("Voice profile enrolled for:", email);
    
    return {
      success: true,
      message: "Voice enrollment complete",
      profileCreated: true,
    };
    
  } catch (error) {
    console.error("Voice enrollment error:", error);
    speakText("Voice enrollment failed. Please try again.");
    return {
      success: false,
      error: error.message,
    };
  }
}

// ── Voice Authentication Login ──
export async function authenticateWithVoice(email) {
  try {
    speakText(`Voice authentication for ${email}. Please say the enrollment phrase.`);
    
    // Start listening for voice
    const voiceInput = await startVoiceListener('en-US');
    const recognizedText = voiceInput.transcript.toLowerCase();
    
    // Check if profile exists
    const voiceProfile = voiceProfiles.get(email);
    if (!voiceProfile) {
      speakText("Voice profile not found. Please enroll first.");
      return {
        authenticated: false,
        error: "Voice profile not found",
      };
    }
    
    // Verify the enrollment phrase
    const enrollmentPhrase = voiceProfile.enrollmentPhrase.toLowerCase();
    const similarity = calculateSimilarity(recognizedText, enrollmentPhrase);
    
    console.log("Voice similarity score:", similarity);
    
    // If similarity is above 70%, consider it authenticated
    if (similarity > 70) {
      speakText("Voice authentication successful. Welcome back.");
      
      // Sign in with Firebase
      const result = await signInWithEmail(email, "voice_auth_" + voiceProfile.userId);
      
      return {
        authenticated: true,
        user: result.user,
        confidenceScore: similarity,
      };
    } else {
      speakText("Voice authentication failed. Please try again or use another login method.");
      return {
        authenticated: false,
        error: "Voice did not match enrollment",
        confidenceScore: similarity,
      };
    }
    
  } catch (error) {
    console.error("Voice authentication error:", error);
    speakText("Voice authentication error. Please try again.");
    return {
      authenticated: false,
      error: error.message,
    };
  }
}

// ── Helper: Calculate Voice/Text Similarity (Levenshtein Distance) ──
function calculateSimilarity(input, reference) {
  const distance = levenshteinDistance(input, reference);
  const maxLength = Math.max(input.length, reference.length);
  const similarity = ((maxLength - distance) / maxLength) * 100;
  return Math.round(similarity);
}

// ── Levenshtein Distance Algorithm ──
function levenshteinDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

// ── Stop Voice Listener ──
export function stopVoiceListener() {
  recognition.stop();
}

// – Voice Auth Status Check ──
export async function checkVoiceAuthAvailable(email) {
  try {
    const profile = voiceProfiles.get(email);
    if (profile && profile.isVerified) {
      return {
        voiceAuthAvailable: true,
        enrollmentDate: profile.enrollmentDate,
      };
    }
    
    // Check Firestore if not in memory
    try {
      const docSnap = await getDoc(doc(db, 'voiceProfiles', email));
      if (docSnap.exists() && docSnap.data().isActive) {
        return {
          voiceAuthAvailable: true,
          enrollmentDate: docSnap.data().enrollmentDate,
        };
      }
    } catch (err) {
      console.warn("Firestore check skipped");
    }
    
    return { voiceAuthAvailable: false };
  } catch (error) {
    console.error("Voice auth check error:", error);
    return { voiceAuthAvailable: false, error: error.message };
  }
}

// ── Exports ──────────────────────────────────
export { 
  auth, 
  db, 
  app, 
  analytics, 
  collection, 
  onSnapshot,
  // Voice auth exports
  recordVoiceSample,
  speakText,
  startVoiceListener,
  enrollCandidateVoice,
  authenticateWithVoice,
  stopVoiceListener,
  checkVoiceAuthAvailable,
};