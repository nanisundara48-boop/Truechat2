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
let currentChatUser = null; // Who are we talking to?
let chatId = null; // Unique ID for the conversation
let peer = null;

// --- AUTH STATE & INITIAL LOAD ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        
        // Load Profile
        document.getElementById('my-name').innerText = user.displayName || "User";
        if(user.photoURL) document.getElementById('my-dp').src = user.photoURL;

        // Save User to DB if not exists (Important for Search)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            email: user.email.toLowerCase(), // Save as lowercase for search
            displayName: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL || "https://via.placeholder.com/50",
            lastSeen: serverTimestamp()
        }, { merge: true });

        // Listeners
        listenToFriends();
        listenToRequests();
        initPeer(user.uid);
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// --- 1. SEARCH & REQUEST SYSTEM ---

window.searchUser = async () => {
    const input = document.getElementById('search-input').value.toLowerCase().trim();
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = "Searching...";

    if(input === currentUser.email) return resultsDiv.innerHTML = "That's you!";

    // Query by Email
    const q = query(collection(db, "users"), where("email", "==", input));
    const querySnapshot = await getDocs(q);

    resultsDiv.innerHTML = "";
    if (querySnapshot.empty) {
        resultsDiv.innerHTML = "<p>User not found. Check email.</p>";
        return;
    }

    querySnapshot.forEach((doc) => {
        const user = doc.data();
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `
            <img src="${user.photoURL}">
            <span>${user.displayName}</span>
            <button class="action-btn btn-primary" onclick="sendRequest('${user.uid}')">Add</button>
        `;
        resultsDiv.appendChild(div);
    });
};

window.sendRequest = async (targetUid) => {
    try {
        // Add to target's "requests" array
        await updateDoc(doc(db, "users", targetUid), {
            requests: arrayUnion(currentUser.uid)
        });
        alert("Request Sent!");
    } catch (e) { alert("Error sending request"); }
};

// --- 2. MANAGE REQUESTS ---
function listenToRequests() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const data = docSnap.data();
        const reqList = document.getElementById('requests-list');
        const badge = document.getElementById('req-badge');
        
        reqList.innerHTML = "";
        const requests = data.requests || [];
        badge.innerText = requests.length;

        if (requests.length === 0) reqList.innerHTML = "<p>No new requests.</p>";

        for (const reqUid of requests) {
            // Fetch info of requester
            const reqUserSnap = await getDoc(doc(db, "users", reqUid));
            const reqUser = reqUserSnap.data();

            const div = document.createElement('div');
            div.className = 'user-card';
            div.innerHTML = `
                <img src="${reqUser.photoURL}">
                <span>${reqUser.displayName}</span>
                <div>
                    <button class="action-btn btn-primary" onclick="acceptRequest('${reqUid}')">Accept</button>
                    <button class="action-btn btn-secondary" onclick="declineRequest('${reqUid}')">X</button>
                </div>
            `;
            reqList.appendChild(div);
        }
    });
}

window.acceptRequest = async (friendUid) => {
    // 1. Remove from requests
    await updateDoc(doc(db, "users", currentUser.uid), {
        requests: arrayRemove(friendUid),
        friends: arrayUnion(friendUid)
    });
    // 2. Add me to their friends
    await updateDoc(doc(db, "users", friendUid), {
        friends: arrayUnion(currentUser.uid)
    });
    alert("Friend Added!");
};

window.declineRequest = async (friendUid) => {
    await updateDoc(doc(db, "users", currentUser.uid), {
        requests: arrayRemove(friendUid)
    });
};

// --- 3. FRIENDS LIST & SELECT CHAT ---
function listenToFriends() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const data = docSnap.data();
        const listDiv = document.getElementById('friends-list');
        listDiv.innerHTML = "";
        
        const friends = data.friends || [];
        if (friends.length === 0) listDiv.innerHTML = "<p>Search users to add friends.</p>";

        for (const fUid of friends) {
            const fSnap = await getDoc(doc(db, "users", fUid));
            const fData = fSnap.data();
            
            const div = document.createElement('div');
            div.className = 'user-card';
            div.innerHTML = `
                <img src="${fData.photoURL}">
                <span>${fData.displayName}</span>
            `;
            div.onclick = () => openChat(fData);
            listDiv.appendChild(div);
        }
    });
}

window.openChat = (friendData) => {
    currentChatUser = friendData;
    
    // Create Unique Chat ID: Always (SmallerUID_LargerUID)
    const uid1 = currentUser.uid < friendData.uid ? currentUser.uid : friendData.uid;
    const uid2 = currentUser.uid < friendData.uid ? friendData.uid : currentUser.uid;
    chatId = `${uid1}_${uid2}`;

    // UI Update
    document.getElementById('chat-user-name').innerText = friendData.displayName;
    document.getElementById('chat-user-img').src = friendData.photoURL;
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('input-area').classList.remove('hidden');
    
    // Mobile View
    document.querySelector('.chat-area').classList.add('active');
    
    loadPrivateMessages();
};

window.closeChat = () => {
    document.querySelector('.chat-area').classList.remove('active');
};

// --- 4. MESSAGING (PRIVATE) ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !chatId) return;

    await addDoc(collection(db, "messages"), {
        text: text,
        sender: currentUser.uid,
        chatId: chatId, // Important!
        createdAt: serverTimestamp(),
        seen: false
    });
    input.value = "";
};

function loadPrivateMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = ""; // Clear old chat

    const q = query(
        collection(db, "messages"), 
        where("chatId", "==", chatId), // Only fetch this chat
        orderBy("createdAt", "asc")
    );

    onSnapshot(q, (snapshot) => {
        container.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            const div = document.createElement('div');
            div.className = `msg ${data.sender === currentUser.uid ? 'sent' : 'received'}`;
            div.innerText = data.text;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
    });
}

// --- 5. DP UPLOAD FIX ---
window.changeDP = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if(!file) return;

        try {
            alert("Uploading... Please wait");
            const storageRef = ref(storage, `profiles/${currentUser.uid}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            // 1. Update Auth Profile
            await updateProfile(currentUser, { photoURL: url });
            // 2. Update Firestore Database (Crucial!)
            await updateDoc(doc(db, "users", currentUser.uid), { photoURL: url });

            document.getElementById('my-dp').src = url;
            alert("Profile Picture Updated!");
        } catch(err) {
            alert("Upload failed: " + err.message);
        }
    };
    input.click();
};

// --- TABS & UTILS ---
window.showTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    
    document.querySelectorAll('.tabs button').forEach(btn => btn.classList.remove('active-tab'));
    event.target.classList.add('active-tab');
};

// Standard Auth Functions
window.register = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try { 
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        // Create User Doc immediately
        await setDoc(doc(db, "users", cred.user.uid), {
            uid: cred.user.uid,
            email: email.toLowerCase(),
            photoURL: "https://via.placeholder.com/50",
            displayName: email.split('@')[0],
            friends: [],
            requests: []
        });
    } catch(e) { alert(e.message); }
};

window.login = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, email, pass); } catch(e) { alert(e.message); }
};
window.logout = () => signOut(auth);
window.forgotPass = async () => {
    const email = prompt("Enter email:");
    if(email) sendPasswordResetEmail(auth, email);
};

// Basic Call Logic (Requires friend selection)
function initPeer(uid) {
    if(peer) return;
    peer = new Peer(uid);
    peer.on('call', call => {
        if(confirm("Video/Audio Call incoming... Answer?")) {
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                call.answer(stream);
                call.on('stream', remote => {
                    const audio = document.getElementById('remote-audio');
                    audio.srcObject = remote;
                    audio.play();
                });
            });
        }
    });
}
window.startCall = () => {
    if(!currentChatUser) return alert("Select a chat first");
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
        const call = peer.call(currentChatUser.uid, stream);
        call.on('stream', remote => {
             document.getElementById('remote-audio').srcObject = remote;
        });
    });
};
