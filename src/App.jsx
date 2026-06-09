import { useState, useEffect, useRef } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  reload,
} from "firebase/auth";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  updateDoc,
  increment,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { auth, googleProvider, db } from "./firebase";

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Lato:wght@300;400&display=swap');`;
const BANNED_WORDS = ["drugs","cocaine","heroin","buy weed","sell drugs","murder","terrorism"];
const REPORT_THRESHOLD = 3;
const MONTH = 30 * 24 * 3600000;
const ADMIN_UID = "ezPSAlWRjZbqGGTIzWK2LRqLgR12";

export default function App() {
  const [authScreen, setAuthScreen] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [screen, setScreen] = useState("feed");
  const [nickname, setNickname] = useState("");
  const [statements, setStatements] = useState([]);
  const [clicked, setClicked] = useState(new Set());
  const [reported, setReported] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [newStatement, setNewStatement] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const suggestionsRef = useRef(null);
  const [lastStmtDoc, setLastStmtDoc] = useState(null);
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasMoreStmts, setHasMoreStmts] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;
  const [matches, setMatches] = useState([]);
  const [prevMatchCount, setPrevMatchCount] = useState(0);
  const [newMatchDot, setNewMatchDot] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [chatList, setChatList] = useState([]);
  const [savedCommonCounts, setSavedCommonCounts] = useState({}); // {userId: count}
  const [newMessageDot, setNewMessageDot] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [activeChatCommon, setActiveChatCommon] = useState([]); // cached common for active chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showCommon, setShowCommon] = useState(false);
  const [modal, setModal] = useState(null);
  const [showLogoutMenu, setShowLogoutMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [pendingRemovals, setPendingRemovals] = useState(new Set()); // temp removals while panel open
  const [locationInput, setLocationInput] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [savedLocation, setSavedLocation] = useState(null); // {name, lat, lng}
  const [useLocation, setUseLocation] = useState(false);
  const profilePanelRef = useRef(null);
  const [notification, setNotification] = useState(null);
  const [notifKey, setNotifKey] = useState(0);
  const [adminStats, setAdminStats] = useState({ users: 0, statements: 0, chats: 0 });
  const [isBlocked, setIsBlocked] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [completeNickInput, setCompleteNickInput] = useState("");

  const chatEndRef = useRef(null);
  const feedEndRef = useRef(null);

  const showNotif = (msg) => { setNotification(msg); setNotifKey(k => k + 1); };

  // AUTH
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          setNickname(snap.data().nickname);
          setClicked(new Set(snap.data().clicked || []));
          setIsBlocked(snap.data().blocked === true);
          if (snap.data().location) {
            setSavedLocation(snap.data().location);
            setLocationInput(snap.data().location.name);
            setUseLocation(true);
          }
        } else {
          // profile missing — ask user to complete registration
          setProfileIncomplete(true);
        }
      } else {
        setUser(null);
        setNickname("");
        setClicked(new Set());
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleRegister = async () => {
    setAuthError("");
    if (nicknameInput.trim().length < 2) { setAuthError("Nickname too short"); return; }
    if (password !== password2) { setAuthError("Passwords don't match"); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      await setDoc(doc(db, "users", cred.user.uid), {
        nickname: nicknameInput.trim(), clicked: [], ts: serverTimestamp(),
      });
      setNickname(nicknameInput.trim());
      await signOut(auth);
      setAuthScreen("verify");
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleLogin = async () => {
    setAuthError("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await reload(cred.user);
      if (!cred.user.emailVerified) {
        await signOut(auth);
        setAuthError("Please verify your email first. Check your inbox.");
        return;
      }
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setAuthError("Enter your email first"); return; }
    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(auth, email.trim());
      setAuthError("");
      setAuthScreen("resetSent");
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleGoogle = async () => {
    setAuthError("");
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      if (!snap.exists()) {
        const nick = cred.user.displayName?.split(" ")[0]?.toLowerCase() || "user" + Date.now();
        await setDoc(doc(db, "users", cred.user.uid), { nickname: nick, clicked: [], ts: serverTimestamp() });
        setNickname(nick);
      }
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleCompleteProfile = async () => {
    if (completeNickInput.trim().length < 2) return;
    try {
      await setDoc(doc(db, "users", user.uid), {
        nickname: completeNickInput.trim(), clicked: [], ts: serverTimestamp(), blocked: false,
      });
      setNickname(completeNickInput.trim());
      setProfileIncomplete(false);
    } catch (e) {
      // retry on next login
      await signOut(auth);
      setProfileIncomplete(false);
    }
  };

  const searchLocation = async (query) => {
    if (query.length < 2) { setLocationSuggestions([]); return; }
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'HApp/1.0' }
      });
      const data = await res.json();
      setLocationSuggestions(data
        .filter(d => ['city','town','village','municipality'].includes(d.type) || d.addresstype === 'city' || d.addresstype === 'town')
        .slice(0, 5)
        .map(d => ({
          name: [d.address?.city || d.address?.town || d.address?.village || d.name, d.address?.country].filter(Boolean).join(', '),
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        })));
    } catch(e) { setLocationSuggestions([]); }
  };

  const selectLocation = async (loc) => {
    setSavedLocation(loc);
    setLocationInput(loc.name);
    setLocationSuggestions([]);
    setUseLocation(true);
    // save to Firestore
    await updateDoc(doc(db, "users", user.uid), {
      location: { name: loc.name, lat: loc.lat, lng: loc.lng }
    });
  };

  const getDistanceKm = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLng = (lng2-lng1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  };

  const openProfile = async () => {
    // clean up clicked — remove statement IDs that no longer exist
    if (clicked.size > 0) {
      const allStmtIds = new Set(statements.map(s => s.id));
      // also fetch any clicked IDs not in current page
      const orphanIds = [...clicked].filter(id => !allStmtIds.has(id));
      if (orphanIds.length > 0) {
        const cleanedClicked = new Set([...clicked].filter(id => allStmtIds.has(id)));
        setClicked(cleanedClicked);
        await updateDoc(doc(db, "users", user.uid), { clicked: [...cleanedClicked] });
      }
    }
    setShowProfile(true);
  };

  const closeProfile = () => {
    if (pendingRemovals.size > 0) {
      const newClicked = new Set([...clicked].filter(id => !pendingRemovals.has(id)));
      setClicked(newClicked);
      pendingRemovals.forEach(async id => {
        try {
          // just remove agreement — statement stays in feed for others
          await updateDoc(doc(db, "users", user.uid), { clicked: arrayRemove(id) });
          await updateDoc(doc(db, "statements", id), { clicks: increment(-1) }).catch(()=>{});
        } catch(e) {}
      });
      // also remove from user's clicked array
      const newClickedArr = [...newClicked];
      updateDoc(doc(db, "users", user.uid), { clicked: newClickedArr }).catch(()=>{});
      setPendingRemovals(new Set());
    }
    setShowProfile(false);
    setLocationSuggestions([]);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowLogoutMenu(false);
    setScreen("feed");
  };

  // DATA
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "statements"), orderBy("ts", "desc"), limit(20));
    const unsub = onSnapshot(q, async (snap) => {
      const now = Date.now();
      const docs = snap.docs;
      setLastStmtDoc(docs[docs.length - 1] || null);
      setHasMoreStmts(docs.length === 20);
      const validStmts = docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.ts?.toMillis ? (now - s.ts.toMillis() < MONTH) : true)
        .filter(s => (s.reports || 0) < REPORT_THRESHOLD);
      setStatements(validStmts);

      // auto-clean clicked — remove IDs that no longer exist in statements
      // we need all statement IDs not just first page, so we check against full db
      setClicked(prev => {
        if (prev.size === 0) return prev;
        // will be cleaned properly when profile opens
        return prev;
      });
    });
    return unsub;
  }, [user]);

  // infinite scroll — observe sentinel at bottom of feed
  useEffect(() => {
    if (!feedEndRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreStatements(); },
      { threshold: 0.1 }
    );
    observer.observe(feedEndRef.current);
    return () => observer.disconnect();
  }, [lastStmtDoc, hasMoreStmts, loadingMore]);

  const loadMoreStatements = async () => {
    if (!lastStmtDoc || !hasMoreStmts || loadingMore) return;
    setLoadingMore(true);
    const now = Date.now();
    const q = query(collection(db, "statements"), orderBy("ts", "desc"), startAfter(lastStmtDoc), limit(20));
    const snap = await getDocs(q);
    const newDocs = snap.docs;
    setLastStmtDoc(newDocs[newDocs.length - 1] || lastStmtDoc);
    setHasMoreStmts(newDocs.length === 20);
    const newStmts = newDocs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.ts?.toMillis ? (now - s.ts.toMillis() < MONTH) : true)
      .filter(s => (s.reports || 0) < REPORT_THRESHOLD);
    setStatements(prev => {
      const ids = new Set(prev.map(s => s.id));
      return [...prev, ...newStmts.filter(s => !ids.has(s.id))];
    });
    setLoadingMore(false);
  };

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.id !== user.uid));
    });
    return unsub;
  }, [user]);

  // load saved common counts for Messages tab
  useEffect(() => {
    if (!user || allUsers.length === 0) return;
    allUsers.forEach(async u => {
      const chatId = [user.uid, u.id].sort().join("_");
      const commonRef = doc(db, "chats", chatId, "meta", "common");
      try {
        const snap = await getDoc(commonRef);
        if (snap.exists()) {
          const count = snap.data().statements?.length || 0;
          setSavedCommonCounts(prev => ({ ...prev, [u.id]: count }));
        }
      } catch(e) {}
    });
  }, [allUsers, user]);

  // load admin stats
  useEffect(() => {
    if (!user || user.uid !== ADMIN_UID) return;
    const unsub = onSnapshot(collection(db, "users"), snap => {
      setAdminStats(prev => ({ ...prev, users: snap.size }));
    });
    return unsub;
  }, [user]);

  // compute matches + new match dot
  useEffect(() => {
    if (clicked.size === 0) { setMatches([]); return; }
    const computed = allUsers
      .filter(u => !u.blocked)
      .map(u => {
        const uc = new Set(u.clicked || []);
        const common = [...clicked].filter(id => uc.has(id));
        let distKm = null;
        if (useLocation && savedLocation && u.location) {
          distKm = getDistanceKm(savedLocation.lat, savedLocation.lng, u.location.lat, u.location.lng);
        }
        return { ...u, common: common.length, commonIds: common, distKm };
      }).filter(u => u.common > 0)
      .sort((a, b) => {
        if (useLocation && a.distKm !== null && b.distKm !== null) {
          // combine score: distance + overlap
          const scoreA = a.common * 10 - (a.distKm || 0) * 0.01;
          const scoreB = b.common * 10 - (b.distKm || 0) * 0.01;
          return scoreB - scoreA;
        }
        return b.common - a.common;
      });
    setMatches(computed);
    if (computed.length > prevMatchCount && prevMatchCount > 0) {
      setNewMatchDot(true);
    }
    setPrevMatchCount(computed.length);
  }, [clicked, allUsers]);

  // chat list — listens to all users independently from matches so chats survive reset
  useEffect(() => {
    if (!user || allUsers.length === 0) return;
    const unsubs = [];
    const listMap = {};
    allUsers.forEach(u => {
      const chatId = [user.uid, u.id].sort().join("_");
      const q = query(collection(db, "chats", chatId, "messages"), orderBy("ts", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const last = msgs[0] || null;
        if (!last) return;
        const isUnread = last.from !== user.uid;
        const matchUser = matches.find(m => m.id === u.id) || { ...u, common: 0 };
        listMap[u.id] = { matchUser, lastMsg: last, lastTs: last?.ts?.toMillis?.() || 0, unread: isUnread };
        const sorted = Object.values(listMap).sort((a, b) => {
          if (a.unread && !b.unread) return -1;
          if (!a.unread && b.unread) return 1;
          if (a.lastTs && b.lastTs) return b.lastTs - a.lastTs;
          if (a.lastTs && !b.lastTs) return -1;
          if (!a.lastTs && b.lastTs) return 1;
          return b.matchUser.common - a.matchUser.common;
        });
        setChatList(sorted);
        if (sorted.some(c => c.unread)) setNewMessageDot(true);
      });
      unsubs.push(unsub);
    });
    return () => unsubs.forEach(u => u());
  }, [allUsers, user, matches]);

  // active chat messages
  useEffect(() => {
    if (!activeChat || !user) return;
    const chatId = [user.uid, activeChat.id].sort().join("_");
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("ts", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [activeChat, user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // close suggestions on click outside
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // ACTIONS
  const toggleClick = async (id) => {
    if (modal) return;
    if (window._longPressed) { window._longPressed = false; return; }
    const userRef = doc(db, "users", user.uid);
    const stmtRef = doc(db, "statements", id);
    if (clicked.has(id)) {
      setClicked(prev => { const n = new Set(prev); n.delete(id); return n; });
      await updateDoc(userRef, { clicked: arrayRemove(id) });
      await updateDoc(stmtRef, { clicks: increment(-1) });
    } else {
      setClicked(prev => new Set([...prev, id]));
      await updateDoc(userRef, { clicked: arrayUnion(id) });
      await updateDoc(stmtRef, { clicks: increment(1) });
      showNotif("Added to your map");
    }
  };

  const addStatement = async () => {
    if (!newStatement.trim()) return;
    if (isBlocked) { showNotif("Your account has been suspended"); return; }
    if (BANNED_WORDS.some(w => newStatement.toLowerCase().includes(w))) {
      showNotif("This violates our guidelines"); return;
    }
    const duplicate = statements.some(s => s.text.toLowerCase().trim() === newStatement.toLowerCase().trim());
    if (duplicate) { showNotif("This statement already exists"); return; }
    const ref = await addDoc(collection(db, "statements"), {
      text: newStatement.trim(), author: nickname, authorId: user.uid,
      clicks: 1, reports: 0, ts: serverTimestamp(),
    });
    setClicked(prev => new Set([...prev, ref.id]));
    await updateDoc(doc(db, "users", user.uid), { clicked: arrayUnion(ref.id) });
    setNewStatement("");
    showNotif("Statement published");
  };

  const confirmReport = async () => {
    const id = modal.id;
    setReported(prev => new Set([...prev, id]));
    await updateDoc(doc(db, "statements", id), { reports: increment(1) });
    setModal(null);
    showNotif("Report submitted — thank you");
  };

  const deleteStatement = async (id) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "statements", id));
    showNotif("Statement deleted");
  };

  const blockUser = async (uid) => {
    await updateDoc(doc(db, "users", uid), { blocked: true });
    showNotif("User blocked");
  };

  const unblockUser = async (uid) => {
    await updateDoc(doc(db, "users", uid), { blocked: false });
    showNotif("User unblocked");
  };

  const confirmReset = async (fromCommon = false) => {
    if (fromCommon) {
      // reset only in-common panel for active chat — also clear in Firestore
      setActiveChatCommon([]);
      if (activeChat) {
        const chatId = [user.uid, activeChat.id].sort().join("_");
        const commonRef = doc(db, "chats", chatId, "meta", "common");
        await setDoc(commonRef, { statements: [] });
        setSavedCommonCounts(prev => ({ ...prev, [activeChat.id]: 0 }));
      }
      setModal(null);
      showNotif("Common ground cleared");
      return;
    }
    // reset map: clear all clicked and decrement counters on each statement
    const allClicked = [...clicked];
    setClicked(new Set());
    await updateDoc(doc(db, "users", user.uid), { clicked: [] });
    // decrement click count on every statement the user had clicked
    await Promise.all(allClicked.map(id =>
      updateDoc(doc(db, "statements", id), { clicks: increment(-1) }).catch(() => {})
    ));
    setModal(null);
    showNotif("Your map has been cleared");
  };

  const getCommonStatements = (matchUser) => {
    const uc = new Set(matchUser.clicked || []);
    return statements.filter(s => clicked.has(s.id) && uc.has(s.id));
  };

  const openChat = async (matchUser) => {
    setActiveChat(matchUser);
    setShowCommon(false);
    setNewMessageDot(false);
    setScreen("chat");
    const chatId = [user.uid, matchUser.id].sort().join("_");
    const commonRef = doc(db, "chats", chatId, "meta", "common");
    // compute current common statements
    const current = getCommonStatements(matchUser).map(s => ({ id: s.id, text: s.text, author: s.author }));
    // load saved from Firestore
    const commonSnap = await getDoc(commonRef);
    const saved = commonSnap.exists() ? (commonSnap.data().statements || []) : [];
    // merge: keep all saved + add new ones not already saved
    const savedIds = new Set(saved.map(s => s.id));
    const newOnes = current.filter(s => !savedIds.has(s.id));
    const merged = [...saved, ...newOnes];
    setActiveChatCommon(merged);
    // save merged back if anything changed
    if (newOnes.length > 0 || (saved.length === 0 && merged.length > 0)) {
      await setDoc(commonRef, { statements: merged });
    }
    // update savedCommonCounts so Messages tab shows correct number
    setSavedCommonCounts(prev => ({ ...prev, [matchUser.id]: merged.length }));
  };

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const chatId = [user.uid, activeChat.id].sort().join("_");
    await addDoc(collection(db, "chats", chatId, "messages"), {
      from: user.uid, fromNick: nickname,
      text: chatInput.trim(), ts: serverTimestamp(),
    });
    setChatInput("");
  };

  // server-side search
  useEffect(() => {
    if (!user) return;
    if (!searchQuery.trim() || screen !== "feed") {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const q = query(collection(db, "statements"), orderBy("text"), limit(50));
      const snap = await getDocs(q);
      const lower = searchQuery.toLowerCase();
      const results = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.text.toLowerCase().includes(lower))
        .filter(s => !reported.has(s.id))
        .filter(s => !blockedUserIds.has(s.authorId));
      setSearchResults(results);
      setSearchLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, screen, user]);

  // smart sort feed
  const matchUserIds = new Set(matches.map(m => m.id));
  const blockedUserIds = new Set(allUsers.filter(u => u.blocked).map(u => u.id));
  const sortedStatements = [...statements]
    .filter(s => !reported.has(s.id))
    .filter(s => !blockedUserIds.has(s.authorId))
    .sort((a, b) => {
      // if searching — sort by popularity first
      if (searchQuery.trim()) return (b.clicks||0) - (a.clicks||0);
      const aM = matchUserIds.has(a.authorId), bM = matchUserIds.has(b.authorId);
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return (b.ts?.toMillis?.() || 0) - (a.ts?.toMillis?.() || 0);
    });

  const filteredMatches = matches.filter(m =>
    searchQuery === "" || m.nickname?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"Lato,sans-serif",fontWeight:300,letterSpacing:2,fontSize:12,textTransform:"uppercase",color:"#bbb"}}>
      loading
    </div>
  );

  if (user && profileIncomplete) return (
    <>
      <style>{FONT}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"Lato,sans-serif",fontWeight:300,padding:"48px 32px",textAlign:"center",maxWidth:480,margin:"0 auto"}}>
        <div style={{fontFamily:"Playfair Display,serif",fontSize:72,fontWeight:400,letterSpacing:6,marginBottom:8,lineHeight:1}}>H</div>
        <div style={{fontSize:13,color:"#999",lineHeight:2,marginBottom:40}}>One last step —<br/>choose your nickname.</div>
        <input
          style={{width:"100%",border:"none",borderBottom:"1px solid #111",padding:"10px 0",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:18,outline:"none",textAlign:"center",background:"transparent",color:"#111",letterSpacing:1,marginBottom:32}}
          placeholder="nickname"
          value={completeNickInput}
          onChange={e => setCompleteNickInput(e.target.value)}
          onKeyDown={e => e.key==="Enter" && handleCompleteProfile()}
          autoFocus
        />
        <button
          onClick={handleCompleteProfile}
          disabled={completeNickInput.trim().length < 2}
          style={{background:"#111",color:"#fff",border:"none",padding:"14px 48px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:13,letterSpacing:3,textTransform:"uppercase",cursor:"pointer",opacity:completeNickInput.trim().length < 2 ? 0.3 : 1}}
        >
          Enter
        </button>
        <button onClick={handleLogout} style={{marginTop:20,background:"none",border:"none",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"#ccc",cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </>
  );

  if (user && isBlocked) return (
    <>
      <style>{FONT}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"Lato,sans-serif",fontWeight:300,padding:"48px 32px",textAlign:"center",maxWidth:480,margin:"0 auto"}}>
        <div style={{fontFamily:"Playfair Display,serif",fontSize:72,fontWeight:400,letterSpacing:6,marginBottom:8,lineHeight:1}}>H</div>
        <div style={{fontSize:13,color:"#999",lineHeight:2,marginBottom:32}}>Your account has been suspended.<br/>If you think this is a mistake,<br/>please contact us.</div>
        <button onClick={handleLogout} style={{background:"none",border:"1px solid #ddd",padding:"10px 24px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:11,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#999"}}>Sign out</button>
      </div>
    </>
  );

  return (
    <>
      <style>{FONT}</style>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        html{overflow-y:scroll;}
        body{background:#fff;overflow-y:scroll;}
        .app{font-family:'Lato',sans-serif;font-weight:300;background:#fff;min-height:100vh;color:#111;width:100%;max-width:480px;margin:0 auto;position:relative;box-sizing:border-box;}

        /* AUTH */
        .auth{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:48px 32px;}
        .auth-logo{font-family:'Playfair Display',serif;font-size:96px;font-weight:400;letter-spacing:8px;margin-bottom:8px;line-height:1;}
        .auth-tagline{font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:56px;}
        .auth-input{width:100%;border:none;border-bottom:1px solid #ddd;padding:10px 0;font-family:'Lato',sans-serif;font-weight:300;font-size:15px;outline:none;background:transparent;color:#111;margin-bottom:20px;}
        .auth-input::placeholder{color:#ccc;}
        .auth-btn{width:100%;background:#111;color:#fff;border:none;padding:14px;font-family:'Lato',sans-serif;font-weight:300;font-size:13px;letter-spacing:3px;text-transform:uppercase;cursor:pointer;transition:opacity .2s;margin-top:8px;}
        .auth-btn:hover{opacity:.75;}
        .auth-btn.secondary{background:#fff;color:#111;border:1px solid #ddd;margin-top:12px;}
        .auth-btn.secondary:hover{border-color:#111;}
        .auth-error{font-size:12px;color:#c0392b;margin-top:8px;text-align:center;line-height:1.6;}
        .auth-switch{margin-top:24px;font-size:12px;color:#bbb;text-align:center;}
        .auth-switch span{color:#111;cursor:pointer;border-bottom:1px solid #111;}
        .auth-notice{margin-top:32px;font-size:11px;color:#bbb;text-align:center;line-height:2;max-width:280px;}
        .auth-notice strong{color:#999;font-weight:400;}
        .verify-text{font-size:14px;color:#999;text-align:center;line-height:2;margin-bottom:32px;max-width:280px;}

        /* NAV — always visible */
        .nav{padding:0 24px;position:sticky;top:0;background:#fff;z-index:10;width:100%;max-width:480px;box-sizing:border-box;}
        .nav-top{display:flex;align-items:center;justify-content:space-between;padding:18px 0 0;height:46px;position:relative;}
        .nav-logo{font-family:'Playfair Display',serif;font-size:28px;font-weight:400;cursor:pointer;position:absolute;left:50%;transform:translateX(-50%);letter-spacing:4px;}
        .nav-nick{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ccc;flex-shrink:0;}
        .nav-tabs{display:flex;gap:0;padding:12px 0 0;border-bottom:1px solid #f0f0f0;}
        .nav-tab{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#bbb;cursor:pointer;padding-bottom:12px;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;background:none;border-left:none;border-right:none;border-top:none;font-family:'Lato',sans-serif;font-weight:300;display:flex;align-items:center;gap:6px;margin-right:20px;white-space:nowrap;}
        .nav-tab.active{color:#111;border-bottom-color:#111;}
        .nav-tab:hover{color:#111;}
        .nav-dot{width:5px;height:5px;border-radius:50%;background:#111;flex-shrink:0;}
        .nav-divider{display:none;}

        /* LOGOUT MENU */
        .logout-menu{position:absolute;top:32px;left:0;background:#fff;border:1px solid #e0e0e0;padding:8px 0;min-width:140px;z-index:20;}
        .logout-item{display:block;width:100%;padding:10px 16px;font-family:'Lato',sans-serif;font-weight:300;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;cursor:pointer;background:none;border:none;text-align:left;transition:color .15s;}
        .logout-item:hover{color:#111;}

        /* SEARCH */
        .search-bar{padding:12px 24px 0;position:sticky;top:93px;background:#fff;z-index:9;}
        .search-input{width:100%;border:none;border-bottom:1px solid #f0f0f0;padding:8px 0 10px;font-family:'Lato',sans-serif;font-weight:300;font-size:13px;outline:none;background:transparent;color:#111;}
        .search-input::placeholder{color:#ddd;}

        /* CHAT header inside nav area */
        .chat-nav-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0 12px;}
        .chat-with{font-family:'Playfair Display',serif;font-size:17px;font-style:italic;}
        .common-toggle{background:none;border:none;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#bbb;cursor:pointer;padding-bottom:2px;border-bottom:1px solid transparent;transition:all .15s;}
        .common-toggle:hover,.common-toggle.on{color:#111;border-bottom-color:#111;}
        .common-panel{background:#fafafa;border-bottom:1px solid #f0f0f0;max-height:0;overflow:hidden;transition:max-height .3s ease;}
        .common-panel.open{max-height:300px;overflow-y:auto;}
        .common-inner{padding:16px 24px;}
        .common-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;margin-bottom:12px;}
        .common-reset{background:none;border:none;font-family:'Lato',sans-serif;font-weight:300;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#ccc;cursor:pointer;float:right;margin-top:-18px;transition:color .15s;}
        .common-reset:hover{color:#111;}
        .common-stmt{padding:8px 0;border-bottom:1px solid #f0f0f0;}
        .common-stmt:last-child{border-bottom:none;}
        .common-stmt-text{font-family:'Playfair Display',serif;font-style:italic;font-size:14px;color:#111;line-height:1.4;}
        .common-stmt-author{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#ccc;margin-top:3px;}

        /* FEED */
        .feed-section{padding:0 24px 100px;}
        .add-statement{height:56px;display:flex;flex-direction:column;justify-content:center;border-bottom:1px solid #f0f0f0;padding:0;}
        .add-input{width:100%;border:none;border-bottom:1px solid #e8e8e8;padding:4px 0;font-family:'Lato',sans-serif;font-weight:300;font-size:14px;outline:none;background:transparent;color:#111;}
        .add-input::placeholder{color:#ccc;}
        .add-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px;}
        .add-btn{background:none;border:1px solid #111;padding:4px 14px;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .15s;color:#111;}
        .add-btn:hover{background:#111;color:#fff;}
        .reset-btn{background:none;border:none;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ccc;cursor:pointer;padding:0;transition:color .15s;}
        .reset-btn:hover{color:#111;}

        .stmt{display:flex;align-items:center;justify-content:space-between;padding:15px 0;border-bottom:1px solid #f5f5f5;gap:12px;cursor:pointer;transition:opacity .15s;}
        .stmt:hover{opacity:.85;}
        .stmt:hover .report-btn{opacity:1;}
        .stmt-left{flex:1;}
        .stmt-text{font-size:15px;font-weight:300;line-height:1.5;color:#111;transition:all .15s;}
        .stmt-text.on{font-style:italic;font-family:'Playfair Display',serif;}
        .stmt-meta{font-size:10px;letter-spacing:1px;color:#ccc;margin-top:3px;text-transform:uppercase;}
        .stmt-right{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;}
        .dot{width:8px;height:8px;border-radius:50%;border:1px solid #ccc;transition:all .2s;}
        .dot.on{background:#111;border-color:#111;}
        .cnt{font-size:10px;color:#ccc;}
        .r-btn{background:none;border:none;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;color:#ddd;cursor:pointer;padding:2px 4px;transition:color .15s;line-height:1;}
        .r-btn:hover{color:#999;}
        .r-done{font-size:10px;color:#e0a0a0;padding:2px 4px;}

        /* MODAL */
        .overlay{position:fixed;inset:0;background:rgba(255,255,255,.93);z-index:50;display:flex;align-items:center;justify-content:center;padding:32px;}
        .modal{background:#fff;border:1px solid #e0e0e0;padding:32px;max-width:320px;width:100%;text-align:center;}
        .modal-title{font-family:'Playfair Display',serif;font-size:18px;font-style:italic;margin-bottom:12px;}
        .modal-text{font-size:13px;color:#999;line-height:1.7;margin-bottom:28px;}
        .modal-actions{display:flex;gap:12px;justify-content:center;}
        .modal-btn{padding:8px 24px;font-family:'Lato',sans-serif;font-weight:300;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .15s;border:1px solid #ddd;background:none;color:#999;}
        .modal-btn:hover{border-color:#111;color:#111;}
        .modal-btn.danger{border-color:#111;color:#111;}
        .modal-btn.danger:hover{background:#111;color:#fff;}

        /* MATCHES + MESSAGES — same row height */
        .list-section{padding:0 24px 100px;}
        .section-header{height:56px;display:flex;align-items:flex-end;border-bottom:1px solid #f0f0f0;}
        .section-sub{font-family:'Playfair Display',serif;font-size:13px;font-style:italic;color:#999;padding-bottom:16px;width:100%;}
        .list-item{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid #f5f5f5;min-height:64px;}
        .list-item-left{flex:1;min-width:0;}
        .list-nick{font-size:15px;font-weight:300;color:#111;display:flex;align-items:center;gap:8px;}
        .unread-dot{width:5px;height:5px;border-radius:50%;background:#111;flex-shrink:0;}
        .list-sub{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#bbb;margin-top:3px;}
        .list-sub span{color:#111;font-weight:400;}
        .list-preview{font-size:12px;color:#bbb;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;}
        .list-right{flex-shrink:0;margin-left:12px;}
        .write-btn{background:none;border:1px solid #ddd;padding:7px 14px;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;color:#999;transition:all .15s;}
        .write-btn:hover{border-color:#111;color:#111;}
        .list-overlap{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#ddd;}
        .list-overlap span{color:#bbb;}

        /* CHAT BODY */
        .chat-body{display:flex;flex-direction:column;flex:1;min-height:0;}
        .chat-wrapper{display:flex;flex-direction:column;height:100vh;overflow:hidden;}
        .chat-wrapper .nav{flex-shrink:0;}
        .chat-wrapper .nav-divider{flex-shrink:0;}
        .chat-wrapper .common-panel{flex-shrink:0;}
        .chat-msgs{flex:1;overflow-y:auto;padding:24px 24px 16px;display:flex;flex-direction:column;gap:16px;}
        .msg{max-width:78%;line-height:1.55;}
        .msg.you{align-self:flex-end;text-align:right;}
        .msg.them{align-self:flex-start;}
        .msg-text{font-size:14px;font-weight:300;padding:10px 14px;display:inline-block;}
        .msg.you .msg-text{background:#f0f0f0;color:#111;text-align:left;}
        .msg.them .msg-text{background:#f5f5f5;color:#111;}
        .msg-sender{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#ccc;margin-bottom:4px;}
        .chat-input-row{padding:12px 24px 24px;border-top:1px solid #f0f0f0;display:flex;gap:12px;align-items:flex-end;flex-shrink:0;}
        .chat-input{flex:1;border:none;border-bottom:1px solid #e0e0e0;padding:8px 0;font-family:'Lato',sans-serif;font-weight:300;font-size:14px;outline:none;background:#fff;resize:none;line-height:1.5;color:#111 !important;-webkit-text-fill-color:#111 !important;}
        .chat-input::placeholder{color:#ccc;-webkit-text-fill-color:#ccc !important;}
        .send-btn{background:#111;color:#fff;border:none;width:32px;height:32px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;}
        .send-btn:hover{opacity:.7;}

        .empty{padding:64px 0;text-align:center;}

        /* PROFILE PANEL */
        .profile-panel{position:fixed;top:93px;right:0;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#fff;z-index:25;overflow-y:auto;padding:16px 24px 48px;border-top:1px solid #f0f0f0;box-shadow:0 8px 32px rgba(0,0,0,0.06);}
        .profile-panel-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid #f0f0f0;margin-bottom:0;}
        .profile-panel-title{font-family:'Playfair Display',serif;font-size:18px;font-style:italic;}
        .profile-section{padding:16px 0;border-bottom:1px solid #f5f5f5;}
        .profile-section-label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#ccc;margin-bottom:10px;}
        .loc-input{width:100%;border:none;border-bottom:1px solid #e8e8e8;padding:6px 0;font-family:'Lato',sans-serif;font-weight:300;font-size:14px;outline:none;color:#111;background:transparent;}
        .loc-input::placeholder{color:#ccc;}
        .loc-suggestions{margin-top:4px;border:1px solid #f0f0f0;}
        .loc-suggestion{padding:10px 12px;font-size:13px;color:#111;border-bottom:1px solid #f8f8f8;cursor:pointer;}
        .loc-suggestion:last-child{border-bottom:none;}
        .loc-current{font-size:12px;color:#999;margin-top:8px;display:flex;align-items:center;gap:6px;}
        .loc-dot{width:5px;height:5px;border-radius:50%;background:#111;flex-shrink:0;}
        .loc-toggle-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px;}
        .loc-toggle-label{font-size:11px;color:#999;}
        .loc-toggle{width:36px;height:20px;background:#111;border-radius:10px;position:relative;cursor:pointer;flex-shrink:0;transition:background .2s;}
        .loc-toggle.off{background:#e0e0e0;}
        .loc-toggle::after{content:'';position:absolute;width:14px;height:14px;background:#fff;border-radius:50%;top:3px;right:3px;transition:right .2s;}
        .loc-toggle.off::after{right:19px;}
        .profile-stmt{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid #f8f8f8;gap:12px;}
        .profile-stmt-text{font-size:14px;color:#111;line-height:1.4;flex:1;}
        .profile-stmt-text.italic{font-family:'Playfair Display',serif;font-style:italic;}

        .profile-stmt-meta{font-size:10px;color:#ccc;margin-top:2px;letter-spacing:.5px;text-transform:uppercase;}
        .profile-stmt-dot{width:8px;height:8px;border-radius:50%;border:1px solid #ccc;cursor:pointer;flex-shrink:0;transition:all .15s;}
        .profile-stmt-dot.on{background:#111;border-color:#111;}
        .profile-reset{padding:20px 0 0;text-align:center;}
        .profile-reset-btn{background:none;border:none;font-family:'Lato',sans-serif;font-weight:300;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ccc;cursor:pointer;transition:color .15s;}
        .profile-reset-btn:hover{color:#111;}
        .empty p{font-size:13px;color:#ccc;line-height:2;}


        .notif{position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#111;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:10px 20px;pointer-events:none;animation:fade 2.2s ease forwards;white-space:nowrap;z-index:100;}
        @keyframes fade{0%{opacity:0;transform:translateX(-50%) translateY(8px);}12%{opacity:1;transform:translateX(-50%) translateY(0);}75%{opacity:1;}100%{opacity:0;}}
        ::-webkit-scrollbar{width:2px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#e0e0e0;}
      `}</style>

      <div className="app" onClick={() => { if(showProfile) closeProfile(); }}>

        {/* PROFILE PANEL */}
        {showProfile && user && (
          <>
          <div style={{position:"fixed",inset:0,zIndex:24}} onClick={closeProfile}/>
          <div className="profile-panel" ref={profilePanelRef} onClick={e => e.stopPropagation()}>
            <div className="profile-panel-header">
              <div className="profile-panel-title">{nickname}</div>
              <button className="profile-reset-btn" onClick={handleLogout}>sign out</button>
            </div>

            {/* LOCATION */}
            <div className="profile-section">
              <input className="loc-input" placeholder="enter your city…"
                value={locationInput}
                onChange={e => { setLocationInput(e.target.value); searchLocation(e.target.value); }}
              />
              {locationSuggestions.length > 0 && (
                <div className="loc-suggestions">
                  {locationSuggestions.map((loc, i) => (
                    <div key={i} className="loc-suggestion" onClick={() => selectLocation(loc)}>
                      {loc.name}
                    </div>
                  ))}
                </div>
              )}
              {savedLocation && locationSuggestions.length === 0 && (
                <div className="loc-current">
                  <div className="loc-dot"/>
                  <span>{savedLocation.name}</span>
                </div>
              )}
              <div className="loc-toggle-row">
                <div className="loc-toggle-label">Use location in Matches</div>
                <div className={`loc-toggle ${useLocation?"":"off"}`} onClick={() => setUseLocation(v => !v)}/>
              </div>
            </div>

            {/* RESET */}
            <div style={{padding:"16px 0",borderBottom:"1px solid #f5f5f5"}}>
              <button className="profile-reset-btn" onClick={() => { setModal({type:"reset",fromCommon:false}); closeProfile(); }}>
                reset all statements
              </button>
            </div>

            {/* OWN STATEMENTS */}
            {statements.filter(s => s.authorId === user.uid).length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">Your statements</div>
                {statements.filter(s => s.authorId === user.uid).map(s => (
                  <div key={s.id} className="profile-stmt" style={{cursor:"pointer"}}
                    onClick={() => {
                      if (pendingRemovals.has(s.id)) {
                        setPendingRemovals(prev => { const n = new Set(prev); n.delete(s.id); return n; });
                      } else {
                        setPendingRemovals(prev => new Set([...prev, s.id]));
                      }
                    }}>
                    <div>
                      <div className="profile-stmt-text italic">{s.text}</div>
                    </div>
                    <div className={`profile-stmt-dot ${clicked.has(s.id) && !pendingRemovals.has(s.id) ? "on" : ""}`}/>
                  </div>
                ))}
              </div>
            )}

            {/* AGREED STATEMENTS */}
            {statements.filter(s => s.authorId !== user.uid && clicked.has(s.id) && !pendingRemovals.has(s.id)).length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">Statements you agreed with</div>
                {statements.filter(s => s.authorId !== user.uid && clicked.has(s.id)).map(s => (
                  <div key={s.id} className="profile-stmt" style={{cursor:"pointer"}}
                    onClick={() => {
                      if (pendingRemovals.has(s.id)) {
                        setPendingRemovals(prev => { const n = new Set(prev); n.delete(s.id); return n; });
                      } else {
                        setPendingRemovals(prev => new Set([...prev, s.id]));
                      }
                    }}>
                    <div>
                      <div className="profile-stmt-text">{s.text}</div>
                      <div className="profile-stmt-meta">{s.author}</div>
                    </div>
                    <div className={`profile-stmt-dot ${clicked.has(s.id) && !pendingRemovals.has(s.id) ? "on" : ""}`}/>
                  </div>
                ))}
              </div>
            )}



          </div>
          </>
        )}

        {/* MODAL */}
        {modal && (
          <div className="overlay">
            <div className="modal">
              {modal.type === "report" && <>
                <div className="modal-title">Report this statement?</div>
                <div className="modal-text">It will be hidden if others report it too.<br/>Thank you for keeping H safe.</div>
                <div className="modal-actions">
                  <button className="modal-btn" onClick={() => setModal(null)}>Cancel</button>
                  <button className="modal-btn danger" onClick={confirmReport}>Report</button>
                </div>
              </>}
              {modal.type === "reset" && <>
                <div className="modal-title">Clear your map?</div>
                <div className="modal-text">All your statements and agreements will be removed. Your conversations will remain.<br/><br/>This cannot be undone.</div>
                <div className="modal-actions">
                  <button className="modal-btn" onClick={() => setModal(null)}>Cancel</button>
                  <button className="modal-btn danger" onClick={() => confirmReset(modal.fromCommon)}>Clear map</button>
                </div>
              </>}
            </div>
          </div>
        )}

        {/* AUTH */}
        {!user && authScreen === "login" && (
          <div className="auth">
            <div className="auth-logo">H</div>
            <div className="auth-tagline">find your people</div>
            <input className="auth-input" placeholder="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="auth-input" placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key==="Enter" && handleLogin()} />
            {authError && <div className="auth-error">{authError}</div>}
            <button className="auth-btn" onClick={handleLogin}>Sign in</button>
            <button className="auth-btn secondary" onClick={handleGoogle}>Continue with Google</button>
            <div className="auth-switch">No account? <span onClick={() => { setAuthScreen("register"); setAuthError(""); }}>Create one</span></div>
            <div className="auth-switch" style={{marginTop:8}}>Forgot password? <span onClick={handleForgotPassword}>Reset it</span></div>
            <div className="auth-notice">
              <strong>H is open by design.</strong><br/>
              Your statements and nickname are visible to everyone.<br/>
              For privacy, take conversations to your own messengers.
            </div>
          </div>
        )}

        {!user && authScreen === "register" && (
          <div className="auth">
            <div className="auth-logo">H</div>
            <div className="auth-tagline">create account</div>
            <input className="auth-input" placeholder="nickname (visible to others)" value={nicknameInput} onChange={e => setNicknameInput(e.target.value)} />
            <input className="auth-input" placeholder="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="auth-input" placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
            <input className="auth-input" placeholder="confirm password" type="password" value={password2} onChange={e => setPassword2(e.target.value)} onKeyDown={e => e.key==="Enter" && handleRegister()} />
            {authError && <div className="auth-error">{authError}</div>}
            <button className="auth-btn" onClick={handleRegister}>Create account</button>
            <button className="auth-btn secondary" onClick={handleGoogle}>Continue with Google</button>
            <div className="auth-switch">Have an account? <span onClick={() => { setAuthScreen("login"); setAuthError(""); }}>Sign in</span></div>
          </div>
        )}

        {!user && authScreen === "resetSent" && (
          <div className="auth">
            <div className="auth-logo">H</div>
            <div className="verify-text">
              Check your email —<br/>we sent a password reset link.<br/><br/>
              After resetting, come back and sign in.
            </div>
            <button className="auth-btn" onClick={() => { setAuthScreen("login"); setAuthError(""); }}>Go to sign in</button>
          </div>
        )}

        {!user && authScreen === "verify" && (
          <div className="auth">
            <div className="auth-logo">H</div>
            <div className="verify-text">Check your email and confirm your address.<br/><br/>Then come back and sign in.</div>
            <button className="auth-btn" onClick={() => setAuthScreen("login")}>Go to sign in</button>
          </div>
        )}

        {/* MAIN APP — nav always visible */}
        {user && (
          <div className={screen==="chat" ? "chat-wrapper" : ""}>
            <div className="nav">
              <div className="nav-top">
                <div className="nav-nick" style={{visibility:"hidden"}}>{nickname}</div>
                <div className="nav-logo" style={{cursor:"default"}}>
                  H

                </div>
                <div className="nav-nick" style={{cursor:"pointer"}} onClick={(e) => { e.stopPropagation(); if(showProfile) closeProfile(); else openProfile(); }}>{nickname}</div>
              </div>
              <div className="nav-tabs">
                <button className={`nav-tab ${screen==="feed"?"active":""}`} onClick={() => { setScreen("feed"); setSearchQuery(""); }}>
                  Statements
                </button>
                <button className={`nav-tab ${screen==="matches"?"active":""}`} onClick={() => { setScreen("matches"); setSearchQuery(""); setNewMatchDot(false); }}>
                  Matches {newMatchDot && screen!=="matches" && <span className="nav-dot"/>}
                </button>
                <button className={`nav-tab ${screen==="messages"?"active":""}`} onClick={() => { setScreen("messages"); setSearchQuery(""); setNewMessageDot(false); }}>
                  Messages {newMessageDot && screen!=="messages" && <span className="nav-dot"/>}
                </button>
                {user.uid === ADMIN_UID && (
                  <button className={`nav-tab ${screen==="admin"?"active":""}`} onClick={() => { setScreen("admin"); setSearchQuery(""); }}>
                    Admin
                  </button>
                )}
              </div>

              {/* chat name + in common button — shown only in chat screen */}
              {screen==="chat" && activeChat && (
                <div className="chat-nav-row">
                  <div className="chat-with">{activeChat.nickname}</div>
                  <button className={`common-toggle ${showCommon?"on":""}`} onClick={() => setShowCommon(!showCommon)}>
                    {activeChatCommon.length} in common
                  </button>
                </div>
              )}
            </div>
            <hr className="nav-divider"/>

            {/* common panel — shown only in chat */}
            {screen==="chat" && activeChat && (
              <div className={`common-panel ${showCommon?"open":""}`}>
                <div className="common-inner">
                  <div className="common-title">
                    what you share
                    <button className="common-reset" onClick={() => setModal({type:"reset", fromCommon:true})}>reset</button>
                  </div>
                  {activeChatCommon.length === 0 && (
                    <div style={{fontSize:12,color:"#ccc",paddingTop:8}}>no common statements</div>
                  )}
                  {activeChatCommon.map(s => (
                    <div key={s.id} className="common-stmt">
                      <div className="common-stmt-text">{s.text}</div>
                      <div className="common-stmt-author">{s.author}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* search bar — not in chat */}
            {screen !== "chat" && screen !== "feed" && (
              <div className="search-bar">
                <input className="search-input"
                  placeholder={screen==="matches" ? "search by nickname…" : "search conversations…"}
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
            )}

            {/* FEED */}
            {screen==="feed" && (
              <div className="feed-section">
                <div className="add-statement">
                  <input className="add-input" placeholder="write a statement about yourself… or search"
                    value={newStatement}
                    onChange={e => {
                      const val = e.target.value;
                      setNewStatement(val);
                      if (val.trim().length > 2) {
                        const lower = val.toLowerCase();
                        const found = statements
                          .filter(s => s.text.toLowerCase().includes(lower) || lower.split(" ").some(w => w.length > 2 && s.text.toLowerCase().includes(w)))
                          .filter(s => s.text.toLowerCase() !== val.toLowerCase())
                          .sort((a, b) => (b.clicks||0) - (a.clicks||0))
                          .slice(0, 10);
                        setSuggestions(found);
                      } else {
                        setSuggestions([]);
                      }
                    }}
                    onKeyDown={e => { if(e.key==="Enter") { addStatement(); setSuggestions([]); } }}
                  />
                  {suggestions.length > 0 && (
                    <div ref={suggestionsRef} style={{borderTop:"1px solid #f0f0f0",marginTop:8}}>
                      <div style={{padding:"8px 0 4px",fontSize:9,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>similar statements</div>
                      <div style={{maxHeight:280,overflowY:"auto"}}>
                      {suggestions.map(s => (
                        <div key={s.id}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #f8f8f8",cursor:"pointer",gap:12}}
                          onClick={() => { toggleClick(s.id); }}
                        >
                          <div style={{fontSize:13,color:"#111",fontFamily:"Playfair Display,serif",fontStyle:"italic",flex:1,lineHeight:1.4}}>{s.text}</div>
                          <div style={{fontSize:10,color:"#ccc",flexShrink:0}}>{(s.clicks||0).toLocaleString()}</div>
                          <div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:clicked.has(s.id)?"#111":"transparent",border:clicked.has(s.id)?"1px solid #111":"1px solid #ccc"}}/>
                        </div>
                      ))}
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"center",marginTop:4}}>
                    <button className="add-btn" onClick={addStatement}>Publish</button>
                  </div>
                </div>
                {searchLoading && <div style={{padding:"24px 0",textAlign:"center",fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>searching…</div>}
                {!searchLoading && (searchResults ?? sortedStatements).length === 0 && (
                  <div className="empty"><p>{searchQuery ? "nothing found" : "no statements yet"}<br/>{!searchQuery && "be the first to write one"}</p></div>
                )}
                {!searchLoading && (searchResults ?? sortedStatements).map(s => (
                  <div key={s.id} className="stmt" onClick={() => toggleClick(s.id)}>
                    <div className="stmt-left">
                      <div className={`stmt-text ${clicked.has(s.id)?"on":""}`}>{s.text}</div>
                      <div className="stmt-meta">{s.author}</div>
                    </div>
                    <div className="stmt-right">
                      <div className={`dot ${clicked.has(s.id)?"on":""}`}/>
                      <div className="cnt">{Math.max(0, s.clicks||0).toLocaleString()}</div>
                      {s.authorId !== user.uid && !reported.has(s.id) && (
                        <button className="r-btn"
                          onClick={e => { e.stopPropagation(); setModal({type:"report",id:s.id}); }}>
                          r
                        </button>
                      )}
                      {reported.has(s.id) && <span className="r-done">r</span>}
                    </div>
                  </div>
                ))}
                {hasMoreStmts && (
                  <div ref={feedEndRef} style={{padding:"16px 0",textAlign:"center"}}>
                    {loadingMore && <span style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>loading…</span>}
                  </div>
                )}
              </div>
            )}

            {/* MATCHES */}
            {screen==="matches" && (
              <div className="list-section">
                <div className="section-header">
                  <div className="section-sub">people who share your words</div>
                </div>
                {matches.length===0 ? (
                  <div className="empty"><p>click statements in the feed<br/>to find people who think like you</p></div>
                ) : filteredMatches.length===0 ? (
                  <div className="empty"><p>no match found for "{searchQuery}"</p></div>
                ) : filteredMatches.map(m => (
                  <div key={m.id} className="list-item">
                    <div className="list-item-left">
                      <div className="list-nick">{m.nickname}</div>
                      <div className="list-sub">
                        <span>{m.common}</span> in common
                        {m.location && useLocation && savedLocation && (
                          <span style={{marginLeft:8,color:"#ccc"}}>
                            · {m.location.name.split(',')[0] === savedLocation.name.split(',')[0] ? "same city" : m.location.name.split(',')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="list-right">
                      <button className="write-btn" onClick={() => openChat(m)}>Write</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* MESSAGES */}
            {screen==="messages" && (
              <div className="list-section">
                <div className="section-header">
                  <div className="section-sub">your conversations</div>
                </div>
                {chatList.length===0 ? (
                  <div className="empty"><p>no conversations yet<br/>find matches and start writing</p></div>
                ) : chatList
                  .filter(c => searchQuery==="" || c.matchUser.nickname?.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(c => (
                    <div key={c.matchUser.id} className="list-item" style={{cursor:"pointer"}} onClick={() => openChat(c.matchUser)}>
                      <div className="list-item-left">
                        <div className="list-nick">
                          {c.unread && <span className="unread-dot"/>}
                          {c.matchUser.nickname}
                        </div>
                        <div className="list-preview">
                          {c.lastMsg ? (c.lastMsg.from===user.uid ? `You: ${c.lastMsg.text}` : c.lastMsg.text) : ""}
                        </div>
                      </div>
                      <div className="list-right">
                        <div className="list-overlap"><span>{savedCommonCounts[c.matchUser.id] ?? c.matchUser.common}</span> in common</div>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* ADMIN */}
            {screen==="admin" && user.uid === ADMIN_UID && (
              <div className="list-section">
                <div className="section-header">
                  <div className="section-sub">administration</div>
                </div>

                {/* stats */}
                <div style={{display:"flex",gap:24,padding:"20px 0",borderBottom:"1px solid #f0f0f0"}}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{adminStats.users}</div>
                    <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>users</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{statements.length}</div>
                    <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>statements</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{allUsers.filter(u => u.clicked?.length > 0).length}</div>
                    <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>active</div>
                  </div>
                </div>

                {/* reported statements */}
                {statements.filter(s => s.reports > 0).length > 0 && (
                  <>
                    <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999"}}>
                      Reported statements
                    </div>
                    {statements.filter(s => s.reports > 0).sort((a,b) => b.reports - a.reports).map(s => (
                      <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,color:"#111"}}>{s.text}</div>
                          <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
                            {s.author} · {s.reports} report{s.reports>1?"s":""}
                          </div>
                        </div>
                        <button onClick={() => deleteStatement(s.id)} style={{background:"none",border:"1px solid #111",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#111",whiteSpace:"nowrap"}}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {/* all statements */}
                <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999",marginTop:8}}>
                  All statements
                </div>
                <div style={{marginBottom:12}}>
                  <input
                    style={{width:"100%",border:"none",borderBottom:"1px solid #f0f0f0",padding:"8px 0",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:13,outline:"none",background:"transparent",color:"#111"}}
                    placeholder="search…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                {statements
                  .filter(s => searchQuery==="" || s.text.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(s => (
                  <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,color:"#111"}}>{s.text}</div>
                      <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
                        {s.author} · {(s.clicks||0).toLocaleString()} clicks
                        {s.reports > 0 && <span style={{color:"#e0a0a0"}}> · {s.reports} reports</span>}
                      </div>
                    </div>
                    <button onClick={() => deleteStatement(s.id)} style={{background:"none",border:"1px solid #ddd",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#999",whiteSpace:"nowrap",transition:"all .15s"}}>
                      Delete
                    </button>
                  </div>
                ))}

                {/* users */}
                <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999",marginTop:8}}>
                  All users
                </div>
                {allUsers.map(u => (
                  <div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,color: u.blocked?"#ccc":"#111"}}>{u.nickname} {u.blocked && "· blocked"}</div>
                      <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
                        {(u.clicked||[]).length} statements clicked
                      </div>
                    </div>
                    <button onClick={() => u.blocked ? unblockUser(u.id) : blockUser(u.id)} style={{background:"none",border:"1px solid #ddd",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color: u.blocked?"#111":"#999",whiteSpace:"nowrap"}}>
                      {u.blocked ? "Unblock" : "Block"}
                    </button>
                  </div>
                ))}
              </div>
            )}



            {/* CHAT */}
            {screen==="chat" && activeChat && (
              <div className="chat-body">
                <div className="chat-msgs">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`msg ${msg.from===user.uid?"you":"them"}`}>
                      {msg.from!==user.uid && <div className="msg-sender">{msg.fromNick}</div>}
                      <div className="msg-text">{msg.text}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef}/>
                </div>
                <div className="chat-input-row">
                  <input className="chat-input" placeholder="write a message…"
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && sendMessage()} />
                  <button className="send-btn" onClick={sendMessage}>↑</button>
                </div>
              </div>
            )}
          </div>
        )}

        {notification && <div className="notif" key={notifKey}>{notification}</div>}
      </div>
    </>
  );
}
