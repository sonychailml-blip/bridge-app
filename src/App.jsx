import { useState, useEffect, useRef } from "react";
import {
  signOut,
  onAuthStateChanged,
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
import { auth, db } from "./firebase";
import "./App.css";
import Auth from "./components/Auth";
import Profile from "./components/Profile";
import Chat from "./components/Chat";


const BANNED_WORDS = ["drugs","cocaine","heroin","buy weed","sell drugs","murder","terrorism"];
const REPORT_THRESHOLD = 3;
const MONTH = 30 * 24 * 3600000;
const ADMIN_UID = "ezPSAlWRjZbqGGTIzWK2LRqLgR12";

export default function App() {

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
  const [savedLocation, setSavedLocation] = useState(null);
  const [useLocation, setUseLocation] = useState(false);
  const [notification, setNotification] = useState(null);
  const [notifKey, setNotifKey] = useState(0);
  const [adminStats, setAdminStats] = useState({ users: 0, statements: 0, chats: 0 });
  const [isBlocked, setIsBlocked] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [completeNickInput, setCompleteNickInput] = useState("");

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



  const getDistanceKm = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLng = (lng2-lng1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  };

  const openProfile = () => setShowProfile(true);
  const closeProfile = () => setShowProfile(false);

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
      setStatements(prev => {
        const localClicks = new Map(prev.map(s => [s.id, s.clicks]));
        return validStmts.map(s => ({
          ...s,
          clicks: localClicks.has(s.id) ? Math.max(s.clicks||0, localClicks.get(s.id)||0) : (s.clicks||0)
        }));
      });

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
      setStatements(prev => prev.map(s => s.id === id ? { ...s, clicks: Math.max(0, (s.clicks||0) - 1) } : s));
      await updateDoc(userRef, { clicked: arrayRemove(id) });
      await updateDoc(stmtRef, { clicks: increment(-1) });
    } else {
      setClicked(prev => new Set([...prev, id]));
      setStatements(prev => prev.map(s => s.id === id ? { ...s, clicks: (s.clicks||0) + 1 } : s));
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
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"Lato,sans-serif",fontWeight:300,padding:"48px 32px",textAlign:"center",maxWidth:480,margin:"0 auto"}}>
        <div style={{fontFamily:"Playfair Display,serif",fontSize:72,fontWeight:400,letterSpacing:6,marginBottom:8,lineHeight:1}}>H</div>
        <div style={{fontSize:13,color:"#999",lineHeight:2,marginBottom:32}}>Your account has been suspended.<br/>If you think this is a mistake,<br/>please contact us.</div>
        <button onClick={handleLogout} style={{background:"none",border:"1px solid #ddd",padding:"10px 24px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:11,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#999"}}>Sign out</button>
      </div>
    </>
  );

  return (
    <>

      <div className="app" onClick={() => { if(showProfile) closeProfile(); }}>

        {/* PROFILE PANEL */}
        {showProfile && user && (
          <Profile
            user={user}
            nickname={nickname}
            statements={statements}
            clicked={clicked}
            setClicked={setClicked}
            setStatements={setStatements}
            useLocation={useLocation}
            setUseLocation={setUseLocation}
            savedLocation={savedLocation}
            setSavedLocation={setSavedLocation}
            onClose={closeProfile}
            onLogout={handleLogout}
            onResetMap={() => setModal({type:"reset",fromCommon:false})}
          />
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
        {!user && <Auth />}

        {/* MAIN APP — nav always visible */}
        {user && (
          <div className={screen==="chat" ? "chat-wrapper" : ""}>
            <div className="nav">
              <div className="nav-top">
                <div className="nav-nick" style={{visibility:"hidden"}}>{nickname}</div>
                <div className="nav-logo" style={{cursor:"default"}}>
                  H

                </div>
<div style={{fontSize:9,color:"#ddd",letterSpacing:1,position:"absolute",left:24,bottom:14}}>v2.6</div>
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
              <>
                <div className="search-bar">
                  <input className="search-input" placeholder="write a statement about yourself… or search"
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
                  <div style={{display:"flex",justifyContent:"center",marginTop:20,paddingBottom:16,borderBottom:"1px solid #f0f0f0"}}>
                    <button className="add-btn" onClick={addStatement}>Publish</button>
                  </div>
                </div>
                <div className="feed-section">
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
              </>
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
              <Chat
                user={user}
                activeChat={activeChat}
                chatMessages={chatMessages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                activeChatCommon={activeChatCommon}
                showCommon={showCommon}
                setShowCommon={setShowCommon}
                onSend={sendMessage}
                onResetCommon={() => setModal({type:"reset", fromCommon:true})}
              />
            )}
          </div>
        )}

        {notification && <div className="notif" key={notifKey}>{notification}</div>}
      </div>
    </>
  );
}
