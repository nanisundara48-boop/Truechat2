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

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('my-name').innerText = user.displayName || user.email.split('@')[0];
        if(user.photoURL) document.getElementById('my-dp').src = user.photoURL;
        
        // Ensure user is in DB
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, email: user.email.toLowerCase(), displayName: user.displayName, 
            photoURL: user.photoURL, lastSeen: serverTimestamp()
        }, { merge: true });

        listenToFriends();
        listenToRequests();
        initPeer(user.uid);
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// --- MESSAGING LOGIC (FIXED) ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !chatId) return;

    // Block check
    const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    if (myData.blocked && myData.blocked.includes(currentChatUser.uid)) {
        return alert("Unblock user to message");
    }

    try {
        await addDoc(collection(db, "messages"), {
            text: text,
            sender: currentUser.uid,
            chatId: chatId,
            createdAt: serverTimestamp(),
            seen: false
        });
        input.value = "";
    } catch(e) { console.error("Msg Error:", e); }
};

function loadMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = "";
    
    // Correct Query
    const q = query(
        collection(db, "messages"), 
        where("chatId", "==", chatId), 
        orderBy("createdAt", "asc")
    );

    onSnapshot(q, (snapshot) => {
        container.innerHTML = ""; 
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // Check Auto-Delete (48h)
            let isExpired = false;
            if (data.createdAt) {
                const diff = (new Date() - data.createdAt.toDate()) / 36e5;
                if(diff > 48) isExpired = true;
            }

            if (!isExpired) {
                const div = document.createElement('div');
                div.className = `msg ${data.sender === currentUser.uid ? 'sent' : 'received'}`;
                div.innerText = data.text;
                container.appendChild(div);
            }
        });
        container.scrollTop = container.scrollHeight;
    });
}

// --- CALLING LOGIC (NEW UI) ---
function initPeer(uid) {
    if(peer) return;
    peer = new Peer(uid);
    
    // INCOMING CALL
    peer.on('call', (call) => {
        activeCall = call;
        showIncomingCallUI(call.peer); // Pass caller ID
        
        // If accepted
        window.answerCall = () => {
             navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                localStream = stream;
                call.answer(stream);
                updateCallUI("Connected", false); 
                
                call.on('stream', remote => {
                    document.getElementById('remote-audio').srcObject = remote;
                });
                call.on('close', resetCallUI);
             });
        };

        // If rejected
        window.rejectCall = () => {
            call.close();
            resetCallUI();
        };
    });
}

// Start Call (Outgoing)
window.startCallUI = async () => {
    if(!currentChatUser) return;
    
    // Show UI
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('call-name').innerText = currentChatUser.displayName;
    document.getElementById('call-avatar').src = currentChatUser.photoURL;
    document.getElementById('call-status').innerText = "Calling...";
    document.getElementById('incoming-controls').classList.add('hidden');
    document.getElementById('ongoing-controls').classList.remove('hidden');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({audio:true});
        const call = peer.call(currentChatUser.uid, localStream);
        activeCall = call;

        call.on('stream', remote => {
            document.getElementById('remote-audio').srcObject = remote;
            document.getElementById('call-status').innerText = "Connected";
        });
        call.on('close', resetCallUI);
        call.on('error', () => { alert("Call Failed"); resetCallUI(); });
        
    } catch(e) {
        alert("Mic permission needed");
        resetCallUI();
    }
};

window.endCall = () => {
    if(activeCall) activeCall.close();
    resetCallUI();
};

async function showIncomingCallUI(callerUid) {
    // Fetch Caller Info
    const userSnap = await getDoc(doc(db, "users", callerUid));
    const callerData = userSnap.data();

    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('call-name').innerText = callerData ? callerData.displayName : "Unknown";
    document.getElementById('call-avatar').src = callerData ? callerData.photoURL : "";
    document.getElementById('call-status').innerText = "Incoming Call...";
    
    document.getElementById('incoming-controls').classList.remove('hidden');
    document.getElementById('ongoing-controls').classList.add('hidden');
}

function updateCallUI(status, isIncoming) {
    document.getElementById('call-status').innerText = status;
    if(!isIncoming) {
        document.getElementById('incoming-controls').classList.add('hidden');
        document.getElementById('ongoing-controls').classList.remove('hidden');
    }
}

function resetCallUI() {
    document.getElementById('call-overlay').classList.add('hidden');
    if(localStream) localStream.getTracks().forEach(track => track.stop());
    activeCall = null;
}

// --- STANDARD FEATURES (Search, Friends, Block) ---
window.openChat = (friendData) => {
    currentChatUser = friendData;
    const uid1 = currentUser.uid < friendData.uid ? currentUser.uid : friendData.uid;
    const uid2 = currentUser.uid < friendData.uid ? friendData.uid : currentUser.uid;
    chatId = `${uid1}_${uid2}`;

    document.getElementById('empty-chat').classList.add('hidden');
    document.getElementById('active-chat').classList.remove('hidden');
    document.getElementById('chat-user-name').innerText = friendData.displayName;
    document.getElementById('chat-user-img').src = friendData.photoURL;
    document.querySelector('.chat-area').classList.add('active');
    
    loadMessages();
};

function listenToFriends() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const friends = docSnap.data().friends || [];
        const listDiv = document.getElementById('friends-list');
        listDiv.innerHTML = "";
        for(const fid of friends) {
            const fData = (await getDoc(doc(db, "users", fid))).data();
            const div = document.createElement('div');
            div.className = 'user-card';
            div.innerHTML = `<img src="${fData.photoURL}"><div><h4>${fData.displayName}</h4><small>Tap to chat</small></div>`;
            div.onclick = () => openChat(fData);
            listDiv.appendChild(div);
        }
    });
}
// Search, Auth, DP Logic same as before...
window.liveSearch = async () => {
    const input = document.getElementById('search-input').value.toLowerCase();
    const res = document.getElementById('search-results');
    if(input.length<3) return res.innerHTML="";
    const q = query(collection(db,"users"), where("email",">=",input), where("email","<=",input+'\uf8ff'));
    const snap = await getDocs(q);
    res.innerHTML="";
    snap.forEach(d=>{
        const u = d.data();
        if(u.uid!==currentUser.uid) {
            res.innerHTML+=`<div class="user-card"><img src="${u.photoURL}"><div><h4>${u.displayName}</h4></div><button class="action-btn" style="background:var(--primary);color:white" onclick="sendRequest('${u.uid}')">Add</button></div>`;
        }
    });
};
window.sendRequest = async(id) => updateDoc(doc(db,"users",id),{requests:arrayUnion(currentUser.uid)});
window.blockUser = async() => {
    if(confirm("Block User?")) {
        await updateDoc(doc(db,"users",currentUser.uid),{blocked:arrayUnion(currentChatUser.uid)});
        alert("Blocked");
    }
};
window.removeFriend = async() => {
    if(confirm("Remove Friend?")) {
        await updateDoc(doc(db,"users",currentUser.uid),{friends:arrayRemove(currentChatUser.uid)});
        await updateDoc(doc(db,"users",currentChatUser.uid),{friends:arrayRemove(currentUser.uid)});
        location.reload();
    }
};
// Nav & Helpers
window.showTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(e=>e.classList.add('hidden'));
    document.getElementById('tab-'+t).classList.remove('hidden');
    document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active-tab'));
    event.currentTarget.classList.add('active-tab');
}
window.closeChat = () => document.querySelector('.chat-area').classList.remove('active');
window.toggleMenu = () => document.getElementById('chat-menu').classList.toggle('hidden');
window.changeDP = () => {
    const i = document.createElement('input'); i.type='file'; i.accept='image/*';
    i.onchange=async(e)=>{
        const f=e.target.files[0]; if(!f)return;
        alert("Uploading...");
        const sRef=ref(storage,`profiles/${currentUser.uid}`);
        await uploadBytes(sRef,f);
        const url=await getDownloadURL(sRef);
        await updateProfile(currentUser,{photoURL:url});
        await updateDoc(doc(db,"users",currentUser.uid),{photoURL:url});
        document.getElementById('my-dp').src=url; alert("Done!");
    }; i.click();
};
// Auth
window.login = async() => { try{await signInWithEmailAndPassword(auth,document.getElementById('email').value,document.getElementById('password').value)}catch(e){alert(e.message)} };
window.register = async() => { try{const c=await createUserWithEmailAndPassword(auth,document.getElementById('email').value,document.getElementById('password').value); await setDoc(doc(db,"users",c.user.uid),{uid:c.user.uid,email:c.user.email,displayName:c.user.email.split('@')[0],photoURL:"https://via.placeholder.com/50",friends:[],requests:[]});}catch(e){alert(e.message)} };
window.logout = () => signOut(auth);
// Listen Requests
function listenToRequests(){onSnapshot(doc(db,"users",currentUser.uid),async(s)=>{
    const d=s.data(); const l=document.getElementById('requests-list');
    document.getElementById('req-badge').innerText=(d.requests||[]).length;
    l.innerHTML="";
    for(const r of d.requests||[]){
        const rd=(await getDoc(doc(db,"users",r))).data();
        l.innerHTML+=`<div class="user-card"><img src="${rd.photoURL}"><h4>${rd.displayName}</h4><button class="action-btn" onclick="acceptReq('${r}')">Accept</button></div>`;
    }
})};
window.acceptReq=async(id)=>{
    await updateDoc(doc(db,"users",currentUser.uid),{requests:arrayRemove(id),friends:arrayUnion(id)});
    await updateDoc(doc(db,"users",id),{friends:arrayUnion(currentUser.uid)});
};
