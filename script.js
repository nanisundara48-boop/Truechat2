import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, serverTimestamp, updateDoc, doc, setDoc, getDocs, arrayUnion, arrayRemove, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyCAsCm1YcsAjHwyvIzxyMrBmZPLw2hlo18",
  authDomain: "truechats-8dac9.firebaseapp.com",
  projectId: "truechats-8dac9",
  storageBucket: "truechats-8dac9.firebasestorage.app",
  messagingSenderId: "685374771914",
  appId: "1:685374771914:web:81bf491264c1bb09061a33"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let currentChatUser = null; 
let chatId = null;
let peer = null;

// --- AUTH & SETUP ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        
        // UI Updates
        document.getElementById('my-name').innerText = user.displayName || "User";
        if(user.photoURL) document.getElementById('my-dp').src = user.photoURL;

        // DB Sync
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            email: user.email.toLowerCase(),
            displayName: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL || "https://via.placeholder.com/50",
            lastSeen: serverTimestamp()
        }, { merge: true });

        listenToFriends();
        listenToRequests();
        initPeer(user.uid);
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// --- 1. DP UPLOAD (FIXED) ---
window.changeDP = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if(!file) return;

        try {
            alert("Uploading Image...");
            const storageRef = ref(storage, `profiles/${currentUser.uid}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            // Update Auth & Firestore (CRITICAL: Updating Firestore makes it visible to others)
            await updateProfile(currentUser, { photoURL: url });
            await updateDoc(doc(db, "users", currentUser.uid), { photoURL: url });

            document.getElementById('my-dp').src = url;
            alert("Profile Picture Updated!");
        } catch(err) {
            alert("Error: " + err.message);
        }
    };
    input.click();
};

// --- 2. SEARCH & REQUESTS ---
window.liveSearch = async () => {
    const input = document.getElementById('search-input').value.toLowerCase().trim();
    const resultsDiv = document.getElementById('search-results');
    
    if(input.length < 3) { resultsDiv.innerHTML = ""; return; }

    // Simple keyword search
    const q = query(collection(db, "users"), where("email", ">=", input), where("email", "<=", input + '\uf8ff'));
    const querySnapshot = await getDocs(q);

    resultsDiv.innerHTML = "";
    querySnapshot.forEach((doc) => {
        const user = doc.data();
        if(user.uid !== currentUser.uid) {
            const div = document.createElement('div');
            div.className = 'user-card';
            div.innerHTML = `
                <img src="${user.photoURL}">
                <div style="flex:1;">
                    <h4>${user.displayName}</h4>
                    <small>${user.email}</small>
                </div>
                <button class="action-btn btn-primary" onclick="sendRequest('${user.uid}')">Add</button>
            `;
            resultsDiv.appendChild(div);
        }
    });
};

window.sendRequest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), { requests: arrayUnion(currentUser.uid) });
        alert("Request Sent!");
    } catch (e) { alert("Could not send request."); }
};

// --- 3. FRIENDS & CHAT ---
function listenToFriends() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const data = docSnap.data();
        const listDiv = document.getElementById('friends-list');
        listDiv.innerHTML = "";
        
        const friends = data.friends || [];
        if (friends.length === 0) listDiv.innerHTML = "<p style='text-align:center; padding:20px; color:#999'>No friends yet. Search to add!</p>";

        for (const fUid of friends) {
            const fSnap = await getDoc(doc(db, "users", fUid));
            if(fSnap.exists()) {
                const fData = fSnap.data();
                const div = document.createElement('div');
                div.className = 'user-card';
                div.innerHTML = `
                    <img src="${fData.photoURL}">
                    <div style="flex:1;">
                        <h4>${fData.displayName}</h4>
                        <small style="color:green">Tap to chat</small>
                    </div>
                `;
                div.onclick = () => openChat(fData);
                listDiv.appendChild(div);
            }
        }
    });
}

window.openChat = (friendData) => {
    currentChatUser = friendData;
    
    // Create Unique ID
    const uid1 = currentUser.uid < friendData.uid ? currentUser.uid : friendData.uid;
    const uid2 = currentUser.uid < friendData.uid ? friendData.uid : currentUser.uid;
    chatId = `${uid1}_${uid2}`;

    // Update UI
    document.getElementById('empty-chat').classList.add('hidden');
    document.getElementById('active-chat').classList.remove('hidden');
    
    document.getElementById('chat-user-name').innerText = friendData.displayName;
    document.getElementById('chat-user-img').src = friendData.photoURL;
    document.getElementById('chat-menu').classList.add('hidden'); // Hide menu initially
    
    // Mobile Transition
    document.querySelector('.chat-area').classList.add('active');
    
    loadMessages();
};

window.closeChat = () => {
    document.querySelector('.chat-area').classList.remove('active');
};

// --- 4. MESSAGING (Auto Delete + Block Check) ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !chatId) return;

    // Check if blocked
    const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    if (myData.blocked && myData.blocked.includes(currentChatUser.uid)) {
        return alert("You blocked this user. Unblock to send messages.");
    }

    await addDoc(collection(db, "messages"), {
        text: text,
        sender: currentUser.uid,
        chatId: chatId,
        createdAt: serverTimestamp(),
        seen: false
    });
    input.value = "";
};

function loadMessages() {
    const container = document.getElementById('messages-container');
    const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("createdAt", "asc"));

    onSnapshot(q, (snapshot) => {
        container.innerHTML = "";
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // Auto Delete Logic (48 hrs)
            if (data.createdAt) {
                const diff = (new Date() - data.createdAt.toDate()) / 36e5;
                if (diff < 48) {
                    const div = document.createElement('div');
                    div.className = `msg ${data.sender === currentUser.uid ? 'sent' : 'received'}`;
                    div.innerText = data.text;
                    container.appendChild(div);
                }
            }
        });
        container.scrollTop = container.scrollHeight;
    });
}

// --- 5. CALL, BLOCK, REMOVE ---
window.toggleMenu = () => {
    const menu = document.getElementById('chat-menu');
    menu.classList.toggle('hidden');
};

// Start Voice Call
window.startCall = () => {
    if(!currentChatUser) return;
    alert(`Calling ${currentChatUser.displayName}...`);
    
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
        const call = peer.call(currentChatUser.uid, stream);
        call.on('stream', remote => {
            document.getElementById('remote-audio').srcObject = remote;
        });
        call.on('close', () => alert("Call Ended"));
    }).catch(e => alert("Please allow Microphone access"));
};

// Initialize PeerJS for Incoming Calls
function initPeer(uid) {
    if(peer) return;
    peer = new Peer(uid);
    peer.on('call', call => {
        if(confirm("Incoming Voice Call... Answer?")) {
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                call.answer(stream);
                call.on('stream', remote => {
                    document.getElementById('remote-audio').srcObject = remote;
                    document.getElementById('remote-audio').play();
                });
            });
        }
    });
}

// Block User
window.blockUser = async () => {
    if(!confirm("Block this user? They won't be able to message you.")) return;
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            blocked: arrayUnion(currentChatUser.uid)
        });
        alert("User Blocked");
        toggleMenu();
    } catch(e) { alert("Error blocking user"); }
};

// Remove Friend
window.removeFriend = async () => {
    if(!confirm("Remove from friends? Chat history will remain until auto-deleted.")) return;
    try {
        // Remove from both sides
        await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayRemove(currentChatUser.uid) });
        await updateDoc(doc(db, "users", currentChatUser.uid), { friends: arrayRemove(currentUser.uid) });
        alert("Friend Removed");
        location.reload(); // Reload to refresh list
    } catch(e) { alert("Error removing friend"); }
};

// --- UTILS ---
window.showTab = (name) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${name}`).classList.remove('hidden');
    document.querySelectorAll('.tabs button').forEach(btn => btn.classList.remove('active-tab'));
    event.currentTarget.classList.add('active-tab');
};
window.login = async () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, e, p); } catch(err){ alert(err.message); }
};
window.register = async () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    try { 
        const c = await createUserWithEmailAndPassword(auth, e, p);
        // Create Doc
        await setDoc(doc(db, "users", c.user.uid), {
            uid: c.user.uid, email: e.toLowerCase(), displayName: e.split('@')[0],
            photoURL: "https://via.placeholder.com/50", friends: [], requests: []
        });
    } catch(err){ alert(err.message); }
};
window.logout = () => signOut(auth);
window.forgotPass = async () => {
    const e = prompt("Enter Email:");
    if(e) sendPasswordResetEmail(auth, e);
};
// Request Listeners (Accept/Decline) - Same as previous but clean
function listenToRequests() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const data = docSnap.data();
        const reqList = document.getElementById('requests-list');
        document.getElementById('req-badge').innerText = (data.requests || []).length;
        
        reqList.innerHTML = "";
        const reqs = data.requests || [];
        if(reqs.length === 0) reqList.innerHTML = "<p style='text-align:center; color:#999'>No new requests</p>";

        for(const rid of reqs) {
            const rSnap = await getDoc(doc(db, "users", rid));
            const rData = rSnap.data();
            const div = document.createElement('div');
            div.className = 'user-card';
            div.innerHTML = `
                <img src="${rData.photoURL}">
                <div style="flex:1"><h4>${rData.displayName}</h4></div>
                <button class="action-btn btn-primary" onclick="acceptRequest('${rid}')">Accept</button>
            `;
            reqList.appendChild(div);
        }
    });
}
window.acceptRequest = async (fid) => {
    await updateDoc(doc(db, "users", currentUser.uid), { requests: arrayRemove(fid), friends: arrayUnion(fid) });
    await updateDoc(doc(db, "users", fid), { friends: arrayUnion(currentUser.uid) });
};
