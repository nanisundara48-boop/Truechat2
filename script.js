// --- IMPORTS (Direct CDN for Acode) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- CONFIGURATION ---
// Mee Firebase Keys ikkada unchandi
const firebaseConfig = {
  apiKey: "AIzaSyCAsCm1YcsAjHwyvIzxyMrBmZPLw2hlo18",
  authDomain: "truechats-8dac9.firebaseapp.com",
  projectId: "truechats-8dac9",
  storageBucket: "truechats-8dac9.firebasestorage.app",
  messagingSenderId: "685374771914",
  appId: "1:685374771914:web:81bf491264c1bb09061a33"
};

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let peer = null;

// --- AUTH STATE LISTENER (White Screen Fix) ---
onAuthStateChanged(auth, (user) => {
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app-screen');

    if (user) {
        // User Logged In
        currentUser = user;
        console.log("Logged in:", user.email);
        
        // Hide Login, Show App
        loginScreen.classList.remove('active');
        loginScreen.classList.add('hidden');
        
        appScreen.classList.remove('hidden');
        appScreen.classList.add('active');

        // Load Data
        updateUI(user);
        loadMessages();
        initPeer(user.uid);
    } else {
        // User Logged Out
        console.log("No user");
        
        // Show Login, Hide App
        appScreen.classList.remove('active');
        appScreen.classList.add('hidden');
        
        loginScreen.classList.remove('hidden');
        loginScreen.classList.add('active');
    }
});

function updateUI(user) {
    document.getElementById('my-username').innerText = user.displayName || user.email.split('@')[0];
    if (user.photoURL) {
        document.getElementById('my-dp').src = user.photoURL;
    }
}

// --- LOGIN / REGISTER LOGIC ---
window.register = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    if(!email || !pass) return alert("Please fill all fields");

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        // Set Default Name
        await updateProfile(cred.user, { displayName: email.split('@')[0] });
        alert("Account Created! You are logged in.");
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.login = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
        alert("Login Failed: " + e.message);
    }
};

window.logout = () => signOut(auth);

window.forgotPass = async () => {
    const email = document.getElementById('email').value;
    if(!email) return alert("Enter email first");
    await sendPasswordResetEmail(auth, email);
    alert("Reset link sent to your email!");
};

// --- CHAT LOGIC (Auto Delete & Seen) ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        await addDoc(collection(db, "chats"), {
            text: text,
            uid: currentUser.uid,
            createdAt: serverTimestamp(),
            seen: false
        });
        input.value = "";
    } catch (e) {
        console.error("Send Error", e);
    }
};

function loadMessages() {
    const chatBox = document.getElementById('chat-container');
    const q = query(collection(db, "chats"), orderBy("createdAt"));

    onSnapshot(q, (snapshot) => {
        chatBox.innerHTML = '<div class="welcome-msg"><p>🔒 Messages are auto-deleted after 48 hours.</p></div>';
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;

            // 1. AUTO DELETE CHECK (48 Hours)
            if (data.createdAt) {
                const msgTime = data.createdAt.toDate();
                const now = new Date();
                const hoursDiff = Math.abs(now - msgTime) / 36e5;

                if (hoursDiff < 48) {
                    renderMessage(id, data, chatBox);
                }
            }
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function renderMessage(id, data, container) {
    const isMe = data.uid === currentUser.uid;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;

    // Mark as Seen if I am receiving it
    if (!isMe && !data.seen) {
        updateDoc(doc(db, "chats", id), { seen: true });
    }

    // Status Icon
    let statusIcon = '';
    if (isMe) {
        statusIcon = data.seen 
            ? '<i class="fa-solid fa-check-double" style="color: #acf;"></i>' // Seen
            : '<i class="fa-solid fa-check"></i>'; // Sent
    }

    const time = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';

    div.innerHTML = `
        ${data.text}
        <div class="msg-info">
            <span>${time}</span>
            ${statusIcon}
        </div>
    `;
    container.appendChild(div);
}

// --- EXTRAS: PROFILE & CALLS ---
window.openProfile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        const storageRef = ref(storage, `profiles/${currentUser.uid}`);
        try {
            alert("Uploading DP...");
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            await updateProfile(currentUser, { photoURL: url });
            document.getElementById('my-dp').src = url;
            alert("Updated!");
        } catch(e) { alert("Upload Failed"); }
    };
    input.click();
};

window.toggleTheme = () => {
    document.body.classList.toggle('dark-mode');
};

// Basic PeerJS Voice Call
function initPeer(uid) {
    if(peer) return;
    peer = new Peer(uid); 
    peer.on('call', (call) => {
        if(confirm("Incoming Voice Call... Answer?")) {
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                call.answer(stream);
                call.on('stream', remote => playAudio(remote));
            });
        }
    });
}

window.startCall = () => {
    const id = prompt("Enter User UID to call:"); // In real app, you select from list
    if(!id) return;
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
        const call = peer.call(id, stream);
        call.on('stream', remote => playAudio(remote));
    });
};

function playAudio(stream) {
    const audio = document.getElementById('remote-audio');
    audio.srcObject = stream;
    audio.play();
}
