// 1. Imports (Direct ga web nunchi load avthayi)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, updateDoc, doc, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// 2. Mee Firebase Configuration (Idhi mee keys tho update chesanu)
const firebaseConfig = {
  apiKey: "AIzaSyCAsCm1YcsAjHwyvIzxyMrBmZPLw2hlo18",
  authDomain: "truechats-8dac9.firebaseapp.com",
  projectId: "truechats-8dac9",
  storageBucket: "truechats-8dac9.firebasestorage.app",
  messagingSenderId: "685374771914",
  appId: "1:685374771914:web:81bf491264c1bb09061a33"
};

// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Variables
let currentUser = null;
let currentLang = "en"; // Default English

// --- AUDIO & VOICE CALL SETUP (PeerJS) ---
// Note: PeerJS script index.html lo load avvali (<script src="...peerjs..."></script>)
let peer = null;

// --- AUTHENTICATION FUNCTIONS ---

// Register (Sign Up)
window.register = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    if(pass.length < 6) return alert("Password min 6 characters undali");
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        // Default Username set cheyadam (Email lo first part)
        await updateProfile(userCredential.user, {
            displayName: email.split('@')[0]
        });
        alert("Account Create Ayyindi! Login Avuthunnaru...");
    } catch (error) {
        alert("Error: " + error.message);
    }
};

// Login
window.login = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // Success ayithe onAuthStateChanged trigger avthundi
    } catch (error) {
        alert("Login Failed: " + error.message);
    }
};

// Forgot Password
window.forgotPass = async () => {
    const email = document.getElementById('email').value;
    if(!email) return alert("Please enter email address first!");
    try {
        await sendPasswordResetEmail(auth, email);
        alert("Password reset link mee email ki pampinchamu. Check cheyandi.");
    } catch (error) {
        alert("Error: " + error.message);
    }
};

// Logout
window.logout = () => {
    signOut(auth).then(() => {
        alert("Logged out successfully");
    });
};

// Auth State Listener (Login/Logout detect chesthundi)
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User Login Ayyaru
        currentUser = user;
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');
        
        // Update UI
        document.getElementById('my-username').innerText = user.displayName || user.email.split('@')[0];
        if(user.photoURL) document.getElementById('my-dp').src = user.photoURL;

        // Load Chats
        loadMessages();
        
        // Initialize Calls (Use UID as Peer ID for simple connection)
        initPeer(user.uid); 
    } else {
        // User Logout Ayyaru
        currentUser = null;
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('app-screen').classList.remove('active');
    }
});

// --- CHAT FUNCTIONS ---

// Send Message
window.sendMessage = async () => {
    const textInput = document.getElementById('msg-input');
    const text = textInput.value;
    
    if (text.trim() === "") return;

    try {
        await addDoc(collection(db, "chats"), {
            text: text,
            uid: currentUser.uid,
            displayName: currentUser.displayName || "User",
            photoURL: currentUser.photoURL || "https://via.placeholder.com/40",
            createdAt: serverTimestamp(),
            seen: false
        });
        textInput.value = ""; // Clear input
    } catch (e) {
        console.error("Error sending message: ", e);
    }
};

// Load Messages & Auto Delete (48 Hrs)
function loadMessages() {
    const chatBox = document.getElementById('chat-container');
    const q = query(collection(db, "chats"), orderBy("createdAt"));

    onSnapshot(q, (snapshot) => {
        chatBox.innerHTML = ""; // Clear old messages to prevent duplicates
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const msgId = docSnap.id;
            
            // Check Time for Auto-Delete (Client Side Hiding)
            // Note: Secure way is using Firebase Cloud Functions (requires blaze plan)
            if (data.createdAt) {
                const msgDate = data.createdAt.toDate();
                const now = new Date();
                const diffMs = now - msgDate;
                const diffHrs = diffMs / (1000 * 60 * 60);

                if (diffHrs < 48) {
                    renderMessage(msgId, data);
                }
            }
        });
        // Scroll to bottom
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function renderMessage(id, data) {
    const chatBox = document.getElementById('chat-container');
    const isMe = data.uid === currentUser.uid;
    
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    // Status Icon (Sent/Seen)
    let statusHTML = '';
    if (isMe) {
        if (data.seen) {
            statusHTML = '<i class="fa-solid fa-check-double" style="color: #53bdeb;"></i>'; // Blue ticks
        } else {
            statusHTML = '<i class="fa-solid fa-check" style="color: grey;"></i>'; // Single tick
        }
    } else {
        // If I am receiving and reading it, mark as seen
        if (!data.seen) {
            markAsSeen(id);
        }
    }

    div.innerHTML = `
        <div class="msg-content">
            ${data.text}
        </div>
        <div class="msg-info">
            <span class="time">${data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}</span>
            ${statusHTML}
        </div>
    `;
    chatBox.appendChild(div);
}

async function markAsSeen(docId) {
    const msgRef = doc(db, "chats", docId);
    await updateDoc(msgRef, { seen: true });
}

// --- PROFILE & SETTINGS ---

// Change Profile Picture
window.openProfile = async () => {
    // Simple prompt implementation for file upload simulation
    // Acode lo easy ga undadaniki: Click cheste file input trigger avvali
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const storageRef = ref(storage, `profiles/${currentUser.uid}`);
        try {
            alert("Uploading Profile Pic...");
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            
            await updateProfile(currentUser, { photoURL: url });
            document.getElementById('my-dp').src = url;
            alert("Profile Picture Updated!");
        } catch (err) {
            alert("Upload failed: " + err.message);
        }
    };
    input.click();
};

// Theme Toggle
window.toggleTheme = () => {
    const body = document.body;
    if (body.classList.contains('theme-blue')) {
        body.className = 'theme-dark';
    } else if (body.classList.contains('theme-dark')) {
        body.className = 'theme-purple';
    } else {
        body.className = 'theme-blue';
    }
};

// Language Toggle (Simulated)
window.toggleLang = () => {
    const btn = document.querySelector('.fa-language');
    if(currentLang === 'en') {
        currentLang = 'te';
        alert("Telugu Mode Activated (Messages will remain as typed, UI logic updated)");
        // Logic to translate static UI elements would go here
    } else {
        currentLang = 'en';
        alert("English Mode Activated");
    }
};


// --- VOICE CALL LOGIC (PeerJS) ---
function initPeer(userId) {
    if(peer) return;
    // Connect to free PeerServer Cloud
    peer = new Peer(userId); 
    
    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
    });

    // Receive Call
    peer.on('call', (call) => {
        const accept = confirm("Incoming Voice Call... Accept?");
        if (accept) {
            navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
                call.answer(stream); // Answer logic
                call.on('stream', (remoteStream) => {
                    playAudio(remoteStream);
                });
            }, (err) => {
                console.error('Failed to get local stream', err);
            });
        } else {
            call.close();
        }
    });
}

// Make Call
window.startCall = () => {
    const destId = prompt("Enter User ID (UID) to call:"); 
    // Note: Real app lo user list nunchi select cheskovali.
    // Testing kosam Firebase Auth UID ni copy chesi ikkada enter cheyali.
    
    if(!destId) return;

    navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
        const call = peer.call(destId, stream);
        call.on('stream', (remoteStream) => {
            playAudio(remoteStream);
        });
    }, (err) => {
        console.error('Failed to get local stream', err);
        alert("Microphone permission required!");
    });
};

function playAudio(stream) {
    const audio = document.getElementById('remote-audio');
    if(audio) {
        audio.srcObject = stream;
        audio.play();
    }
}
