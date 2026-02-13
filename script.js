import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, serverTimestamp, updateDoc, doc, setDoc, getDocs, arrayUnion, arrayRemove, getDoc, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
let activeCall = null;
let localStream = null;

// --- UTILS: Get DP or First Letter ---
function getAvatar(user) {
    if (user.photoURL && user.photoURL.startsWith('http')) {
        return user.photoURL;
    }
    // Generate First Letter Image if no DP
    return `https://ui-avatars.com/api/?name=${user.displayName}&background=random&color=fff&size=128`;
}

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        
        // UI Update
        const dp = getAvatar(user);
        document.getElementById('my-name').innerText = user.displayName;
        document.getElementById('my-dp').src = dp;

        // DB Update (Crucial)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, 
            email: user.email.toLowerCase(), 
            displayName: user.displayName, 
            photoURL: dp, // Save the generated avatar URL
            lastSeen: serverTimestamp()
        }, { merge: true });

        listenFriends();
        listenRequests();
        initPeer(user.uid);
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// --- MESSAGING ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !chatId) return;

    await addDoc(collection(db, "messages"), {
        text: text, sender: currentUser.uid, chatId: chatId, createdAt: serverTimestamp(), seen: false
    });
    input.value = "";
};

function loadMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = "";
    
    const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("createdAt", "asc"));
    onSnapshot(q, (snapshot) => {
        container.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            // Check expiry 48h
            let expired = false;
            if(data.createdAt) {
                if ((new Date() - data.createdAt.toDate()) / 36e5 > 48) expired = true;
            }
            
            if(!expired) {
                const div = document.createElement('div');
                div.className = `msg ${data.sender === currentUser.uid ? 'sent' : 'received'}`;
                div.innerHTML = `${data.text} <span style="font-size:10px; margin-left:5px; opacity:0.7">${new Date(data.createdAt?.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>`;
                container.appendChild(div);
            }
        });
        container.scrollTop = container.scrollHeight;
    });
}

// --- CALLING (Full Screen Logic) ---
function initPeer(uid) {
    if(peer) return;
    peer = new Peer(uid);
    
    peer.on('call', (call) => {
        activeCall = call;
        showIncomingCall(call.peer);
        
        window.answerCall = () => {
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                localStream = stream;
                call.answer(stream);
                updateCallUI("Connected", false);
                call.on('stream', remote => {
                    const aud = document.getElementById('remote-audio');
                    aud.srcObject = remote;
                    aud.play().catch(e => console.log("Auto-play blocked"));
                });
                call.on('close', closeCallScreen);
            });
        };
        window.rejectCall = () => { call.close(); closeCallScreen(); };
    });
}

window.startCallUI = async () => {
    if(!currentChatUser) return;
    
    document.getElementById('call-screen').classList.remove('hidden');
    document.getElementById('call-name').innerText = currentChatUser.displayName;
    document.getElementById('call-avatar').src = getAvatar(currentChatUser);
    document.getElementById('call-status').innerText = "Calling...";
    document.getElementById('incoming-btns').classList.add('hidden');
    document.getElementById('ongoing-btns').classList.remove('hidden');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({audio:true});
        const call = peer.call(currentChatUser.uid, localStream);
        activeCall = call;

        call.on('stream', remote => {
             const aud = document.getElementById('remote-audio');
             aud.srcObject = remote;
             aud.play();
             document.getElementById('call-status').innerText = "Connected";
        });
        call.on('close', closeCallScreen);
        call.on('error', () => { alert("Call Failed/User Offline"); closeCallScreen(); });
    } catch(e) { alert("Mic Permission Denied"); closeCallScreen(); }
};

window.endCall = () => { if(activeCall) activeCall.close(); closeCallScreen(); };

async function showIncomingCall(callerId) {
    const snap = await getDoc(doc(db, "users", callerId));
    const data = snap.data();
    
    document.getElementById('call-screen').classList.remove('hidden');
    document.getElementById('call-name').innerText = data ? data.displayName : "Unknown";
    document.getElementById('call-avatar').src = data ? getAvatar(data) : "";
    document.getElementById('call-status').innerText = "Incoming Call...";
    document.getElementById('incoming-btns').classList.remove('hidden');
    document.getElementById('ongoing-btns').classList.add('hidden');
}

function updateCallUI(status, isIncoming) {
    document.getElementById('call-status').innerText = status;
    if(!isIncoming) {
        document.getElementById('incoming-btns').classList.add('hidden');
        document.getElementById('ongoing-btns').classList.remove('hidden');
    }
}

function closeCallScreen() {
    document.getElementById('call-screen').classList.add('hidden');
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    activeCall = null;
}

// --- SEARCH & REQUESTS (Tick Logic) ---
window.liveSearch = async () => {
    const input = document.getElementById('search-input').value.toLowerCase();
    const res = document.getElementById('search-results');
    if(input.length < 3) return res.innerHTML = "";

    const q = query(collection(db, "users"), where("email", ">=", input), where("email", "<=", input+'\uf8ff'));
    const snap = await getDocs(q);
    res.innerHTML = "";

    snap.forEach(d => {
        const u = d.data();
        if(u.uid !== currentUser.uid) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `
                <img src="${getAvatar(u)}">
                <div style="flex:1"><h4>${u.displayName}</h4><small>${u.email}</small></div>
                <button class="btn-outline" id="btn-${u.uid}" onclick="sendReq('${u.uid}')"><i class="fa fa-user-plus"></i> Add</button>
            `;
            res.appendChild(div);
        }
    });
};

window.sendReq = async (uid) => {
    const btn = document.getElementById(`btn-${uid}`);
    btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i>`;
    try {
        await updateDoc(doc(db, "users", uid), { requests: arrayUnion(currentUser.uid) });
        // Update Button UI to Green Tick
        btn.innerHTML = `<i class="fa fa-check"></i> Sent`;
        btn.style.background = "#2ecc71";
        btn.style.color = "white";
        btn.style.border = "none";
    } catch(e) { alert("Failed"); btn.innerHTML = "Add"; }
};

function listenRequests() {
    onSnapshot(doc(db, "users", currentUser.uid), async (snap) => {
        const list = document.getElementById('requests-list');
        const reqs = snap.data().requests || [];
        document.getElementById('req-badge').innerText = reqs.length;
        list.innerHTML = reqs.length ? "" : "<p style='text-align:center;color:#999'>No requests</p>";

        for (const uid of reqs) {
            const u = (await getDoc(doc(db, "users", uid))).data();
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `
                <img src="${getAvatar(u)}">
                <div style="flex:1"><h4>${u.displayName}</h4></div>
                <button class="btn-main" onclick="acceptReq('${uid}')">Accept</button>
            `;
            list.appendChild(div);
        }
    });
}

window.acceptReq = async (uid) => {
    await updateDoc(doc(db, "users", currentUser.uid), { requests: arrayRemove(uid), friends: arrayUnion(uid) });
    await updateDoc(doc(db, "users", uid), { friends: arrayUnion(currentUser.uid) });
    alert("Accepted! Friend Added ✔");
};

// --- DP UPLOAD ---
window.changeDP = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async (e) => {
        const f = e.target.files[0]; if(!f) return;
        alert("Uploading...");
        const sRef = ref(storage, `profiles/${currentUser.uid}`);
        await uploadBytes(sRef, f);
        const url = await getDownloadURL(sRef);
        await updateProfile(currentUser, { photoURL: url });
        await updateDoc(doc(db, "users", currentUser.uid), { photoURL: url });
        document.getElementById('my-dp').src = url;
    };
    i.click();
};

// --- AUTH & NAV ---
window.login = async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value); }
    catch(e) { alert(e.message); }
};
window.register = async () => {
    const e = document.getElementById('email').value;
    try {
        const c = await createUserWithEmailAndPassword(auth, e, document.getElementById('password').value);
        // Save with Generated Avatar
        const genAvatar = `https://ui-avatars.com/api/?name=${e.split('@')[0]}&background=random&color=fff`;
        await setDoc(doc(db, "users", c.user.uid), {
            uid: c.user.uid, email: e, displayName: e.split('@')[0], 
            photoURL: genAvatar, friends: [], requests: []
        });
    } catch(e) { alert(e.message); }
};
window.logout = () => signOut(auth);
window.showTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    document.getElementById(`tab-${t}`).classList.remove('hidden');
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active-tab'));
    event.currentTarget.classList.add('active-tab');
};
function listenFriends() {
    onSnapshot(doc(db, "users", currentUser.uid), async (snap) => {
        const list = document.getElementById('friends-list');
        list.innerHTML = "";
        const friends = snap.data().friends || [];
        for(const fid of friends) {
            const f = (await getDoc(doc(db, "users", fid))).data();
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `<img src="${getAvatar(f)}"><div><h4>${f.displayName}</h4><small style='color:green'>Tap to chat</small></div>`;
            div.onclick = () => openChat(f);
            list.appendChild(div);
        }
    });
}
window.openChat = (f) => {
    currentChatUser = f;
    const uid1 = currentUser.uid < f.uid ? currentUser.uid : f.uid;
    const uid2 = currentUser.uid < f.uid ? f.uid : currentUser.uid;
    chatId = `${uid1}_${uid2}`;
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('active-chat').classList.remove('hidden');
    document.getElementById('chat-user-name').innerText = f.displayName;
    document.getElementById('chat-user-img').src = getAvatar(f);
    document.querySelector('.chat-area').classList.add('active');
    loadMessages();
};
window.closeChat = () => document.querySelector('.chat-area').classList.remove('active');
window.toggleMenu = () => document.getElementById('chat-menu').classList.toggle('hidden');
