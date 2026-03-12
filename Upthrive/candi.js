import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- 1. CONFIGURATION ---
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);

// --- 2. VOICE SETUP ---
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
const synthesis = window.speechSynthesis;

recognition.continuous = true;
recognition.interimResults = true;
let fullTranscript = "";

// --- 3. CORE FUNCTIONS ---

// Recruiter: Handle File Uploads
window.uploadFiles = async (input) => {
    const file = input.files[0];
    if (!file) return;

    const storageRef = ref(storage, `recruiter_files/${Date.now()}_${file.name}`);
    
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        // Log to Firestore so the system "knows" there is a new job spec
        await addDoc(collection(db, "job_specs"), {
            fileName: file.name,
            fileUrl: downloadURL,
            uploadedAt: serverTimestamp()
        });
        
        alert("File uploaded successfully to Firebase!");
    } catch (error) {
        console.error("Upload failed:", error);
    }
};

// Candidate: Start & Voice Flow
window.startInterview = () => {
    speak("System online. Please state your name and experience.");
    document.getElementById('mic-visualizer').classList.add('active');
    document.getElementById('status-textText').innerText = "LISTENING_";
    recognition.start();
};

recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            fullTranscript += event.results[i][0].transcript + " ";
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }
    document.getElementById('live-transcript').innerText = fullTranscript + interimTranscript;
};

// Candidate: Finish, Save to TXT, and Send to Firebase
window.finishAndSend = async () => {
    recognition.stop();
    document.getElementById('mic-visualizer').classList.remove('active');
    document.getElementById('status-textText').innerText = "UPLOADING_";

    // Create the .txt file blob
    const blob = new Blob([fullTranscript], { type: 'text/plain' });
    const fileName = `interview_${Date.now()}.txt`;

    try {
        // 1. Upload .txt file to Storage
        const storageRef = ref(storage, `transcripts/${fileName}`);
        const snapshot = await uploadBytes(storageRef, blob);
        const fileUrl = await getDownloadURL(snapshot.ref);

        // 2. Save metadata to Firestore for the Recruiter
        await addDoc(collection(db, "submissions"), {
            transcriptUrl: fileUrl,
            contentPreview: fullTranscript.substring(0, 100),
            submittedAt: serverTimestamp(),
            status: "New"
        });

        speak("Interview complete. Your response has been transmitted.");
        alert("Success! Your voice data is now with the recruiter.");
    } catch (e) {
        console.error("Error sending to Firebase:", e);
    }
};

function speak(text) {
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'en-US';
    msg.pitch = 0.8; // Lower pitch for a "Tech" feel
    synthesis.speak(msg);
}