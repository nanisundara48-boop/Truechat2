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

const getAvatar = (u) => u.photoURL ? u.photoURL : `https://ui-avatars.com/api/?name=${u.displayName}&background=random&color=fff`;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('my-name').innerText = user.displayName;
        document.getElementById('my-dp').src = getAvatar(user);
        await setDoc(doc(db, "users", user.uid), { uid: user.uid, email: user.email.toLowerCase(), displayName: user.displayName, photoURL: user.photoURL || null }, { merge: true });
        initPeer(user.uid);
        loadFriends();
        loadRequests();
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// --- MAIN FIX IS HERE (Chat Opening) ---
window.openChat = (u) => {
    currentChatUser = u;
    const uid1 = currentUser.uid < u.uid ? currentUser.uid : u.uid;
    const uid2 = currentUser.uid < u.uid ? u.uid : currentUser.uid;
    chatId = `${uid1}_${uid2}`;

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('chat-interface').classList.remove('hidden');
    document.getElementById('chat-name').innerText = u.displayName;
    document.getElementById('chat-img').src = getAvatar(u);
    
    // Fix for Mobile View
    const chatArea = document.querySelector('.chat-area');
    chatArea.classList.remove('hidden-mobile'); // Invisible class ni teesestunnam
    chatArea.classList.add('active-chat-mobile'); // Slide effect add chestunnam
    
    loadMessages();
};

window.closeChat = () => {
    const chatArea = document.querySelector('.chat-area');
    chatArea.classList.remove('active-chat-mobile');
    // Animation complete ayyaka hide cheyali
    setTimeout(() => {
        chatArea.classList.add('hidden-mobile');
    }, 300);
};

// --- MESSAGES ---
window.sendMessage = async () => {
    const txt = document.getElementById('msg-text').value.trim();
    if(!txt || !chatId) return;
    await addDoc(collection(db, "messages"), { text: txt, sender: currentUser.uid, chatId: chatId, createdAt: serverTimestamp(), seen: false });
    document.getElementById('msg-text').value = "";
};

function loadMessages() {
    const box = document.getElementById('messages');
    box.innerHTML = "";
    const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("createdAt", "asc"));
    onSnapshot(q, (snap) => {
        box.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const isExpired = data.createdAt && (new Date() - data.createdAt.toDate()) > (48 * 60 * 60 * 1000);
            if(!isExpired) {
                const div = document.createElement('div');
                div.className = `msg ${data.sender === currentUser.uid ? 'sent' : 'received'}`;
                const time = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...';
                const tick = data.sender === currentUser.uid ? '<i class="fa fa-check"></i>' : '';
                div.innerHTML = `${data.text} <span style="font-size:10px; float:right; margin-top:5px; margin-left:5px; opacity:0.7">${time} ${tick}</span>`;
                box.appendChild(div);
            }
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- CALLING ---
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
                document.getElementById('call-status').innerText = "Connected";
                document.getElementById('incoming-btns').classList.add('hidden');
                document.getElementById('outgoing-btns').classList.remove('hidden');
                call.on('stream', remote => { document.getElementById('remote-audio').srcObject = remote; });
                call.on('close', closeCallUI);
            });
        };
        window.rejectCall = () => { call.close(); closeCallUI(); };
    });
}
window.startCallUI = async () => {
    if(!currentChatUser) return;
    document.getElementById('call-screen').classList.remove('hidden');
    document.getElementById('call-avatar').src = getAvatar(currentChatUser);
    document.getElementById('call-user').innerText = currentChatUser.displayName;
    document.getElementById('call-status').innerText = "Calling...";
    document.getElementById('incoming-btns').classList.add('hidden');
    document.getElementById('outgoing-btns').classList.remove('hidden');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({audio:true});
        const call = peer.call(currentChatUser.uid, localStream);
        activeCall = call;
        call.on('stream', remote => { document.getElementById('remote-audio').srcObject = remote; document.getElementById('call-status').innerText = "Connected"; });
        call.on('close', closeCallUI);
        call.on('error', () => { alert("Call Failed"); closeCallUI(); });
    } catch(e) { alert("Mic Permission Denied"); closeCallUI(); }
};
window.endCall = () => { if(activeCall) activeCall.close(); closeCallUI(); };
async function showIncomingCall(callerId) {
    const snap = await getDoc(doc(db, "users", callerId));
    const u = snap.data();
    document.getElementById('call-screen').classList.remove('hidden');
    document.getElementById('call-avatar').src = getAvatar(u);
    document.getElementById('call-user').innerText = u.displayName;
    document.getElementById('call-status').innerText = "Incoming Call...";
    document.getElementById('incoming-btns').classList.remove('hidden');
    document.getElementById('outgoing-btns').classList.add('hidden');
}
function closeCallUI() {
    document.getElementById('call-screen').classList.add('hidden');
    if(localStream) localStream.getTracks().forEach(t => t.stop());
}

// --- OTHERS ---
window.searchUsers = async () => {
    const val = document.getElementById('search-input').value.toLowerCase();
    const res = document.getElementById('search-results');
    if(val.length < 3) return res.innerHTML = "";
    const q = query(collection(db, "users"), where("email", ">=", val), where("email", "<=", val+'\uf8ff'));
    const snap = await getDocs(q);
    res.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        if(u.uid !== currentUser.uid) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `<img src="${getAvatar(u)}"><div style="flex:1"><b>${u.displayName}</b><br><small>${u.email}</small></div><button id="btn-${u.uid}" onclick="sendReq('${u.uid}')" style="background:#008069; color:white; border:none; padding:5px 10px; border-radius:5px;">Add</button>`;
            res.appendChild(div);
        }
    });
};
window.sendReq = async (uid) => {
    const btn = document.getElementById(`btn-${uid}`);
    try { await updateDoc(doc(db, "users", uid), { requests: arrayUnion(currentUser.uid) }); btn.innerHTML = `<i class="fa fa-check"></i> Sent`; btn.style.background = "#2ecc71"; } catch(e) { alert("Failed"); }
};
function loadRequests() {
    onSnapshot(doc(db, "users", currentUser.uid), async (snap) => {
        const list = document.getElementById('requests-list');
        const reqs = snap.data().requests || [];
        document.getElementById('req-count').innerText = reqs.length;
        list.innerHTML = "";
        for (const uid of reqs) {
            const u = (await getDoc(doc(db, "users", uid))).data();
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `<img src="${getAvatar(u)}"><div style="flex:1"><b>${u.displayName}</b> sent request</div><button onclick="acceptReq('${uid}')" style="background:#008069; color:white; border:none; padding:5px 10px; border-radius:5px;">Accept</button>`;
            list.appendChild(div);
        }
    });
}
window.acceptReq = async (uid) => {
    await updateDoc(doc(db, "users", currentUser.uid), { requests: arrayRemove(uid), friends: arrayUnion(uid) });
    await updateDoc(doc(db, "users", uid), { friends: arrayUnion(currentUser.uid) });
    alert("Accepted! Friend Added ✔");
};
window.switchTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    document.getElementById(`${t}-tab`).classList.remove('hidden');
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active-tab'));
    event.target.classList.add('active-tab');
};
function loadFriends() {
    onSnapshot(doc(db, "users", currentUser.uid), async (snap) => {
        const list = document.getElementById('friends-list');
        list.innerHTML = "";
        const friends = snap.data().friends || [];
        for (const fid of friends) {
            const f = (await getDoc(doc(db, "users", fid))).data();
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `<img src="${getAvatar(f)}"><div><b>${f.displayName}</b><br><small>Tap to chat</small></div>`;
            div.onclick = () => openChat(f);
            list.appendChild(div);
        }
    });
}
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
window.login = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value); } catch(e){ alert(e.message) } };
window.register = async () => { 
    try { 
        const e = document.getElementById('email').value;
        const c = await createUserWithEmailAndPassword(auth, e, document.getElementById('password').value);
        await setDoc(doc(db, "users", c.user.uid), { uid: c.user.uid, email: e, displayName: e.split('@')[0], photoURL: null, friends: [], requests: [] });
    } catch(e){ alert(e.message) } 
};
window.logout = () => signOut(auth);
window.forgotPass = () => { const e = prompt("Email:"); if(e) sendPasswordResetEmail(auth, e); };
window.removeFriend = async () => {
    if(confirm("Remove friend?")) {
        await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayRemove(currentChatUser.uid) });
        await updateDoc(doc(db, "users", currentChatUser.uid), { friends: arrayRemove(currentUser.uid) });
        closeChat();
    }
};
  
