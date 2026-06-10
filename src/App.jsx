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
import { getFunctions, httpsCallable } from "firebase/functions";
import "./App.css";
import Auth from "./components/Auth";
import Profile from "./components/Profile";
import Chat from "./components/Chat";
import Admin from "./components/Admin";
import Feed from "./components/Feed";
import { useStatements } from "./hooks/useStatements";
import { useUsers } from "./hooks/useUsers";
import { useMatches } from "./hooks/useMatches";
import { useChat } from "./hooks/useChat";
import Matches from "./components/Matches";
import Messages from "./components/Messages";


const ADMIN_UID = "ezPSAlWRjZbqGGTIzWK2LRqLgR12";

export default function App() {

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("feed");
  const [nickname, setNickname] = useState("");
  const [clicked, setClicked] = useState(new Set());
  const [reported, setReported] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const PAGE_SIZE = 20;
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
  const [isBlocked, setIsBlocked] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [completeNickInput, setCompleteNickInput] = useState("");


  const showNotif = (msg) => { setNotification(msg); setNotifKey(k => k + 1); };

  // HOOKS
  const { statements, setStatements, lastStmtDoc, setLastStmtDoc, hasMoreStmts, setHasMoreStmts } = useStatements(user);
  const { allUsers } = useUsers(user);
  const { matches, setMatches, newMatchDot, setNewMatchDot } = useMatches(user, clicked, useLocation, savedLocation);
  const { chatList, savedCommonCounts, setSavedCommonCounts, newMessageDot, setNewMessageDot } = useChat(user, allUsers, matches);

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





  const openProfile = () => setShowProfile(true);
  const closeProfile = () => setShowProfile(false);

  const handleLogout = async () => {
    await signOut(auth);
    setShowLogoutMenu(false);
    setScreen("feed");
  };

  // DATA













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





  // ACTIONS
  const confirmReport = async () => {
    const id = modal.id;
    setReported(prev => new Set([...prev, id]));
    await updateDoc(doc(db, "statements", id), { reports: increment(1) });
    setModal(null);
    showNotif("Report submitted — thank you");
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
    // reset map — через сервер
    setClicked(new Set());
    setStatements(prev => prev.map(s => clicked.has(s.id) ? { ...s, clicks: Math.max(0, (s.clicks||0) - 1) } : s));
    setModal(null);
    showNotif("Your map has been cleared");
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const resetMap = httpsCallable(fns, "resetMap");
      await resetMap();
    } catch(e) {
      console.error("resetMap error:", e);
    }
  };

  const getCommonStatements = (matchUser) => {
    // Ищем пересечение clicked обоих пользователей среди существующих утверждений
    const uc = new Set(matchUser.clicked || []);
    const commonIds = [...clicked].filter(id => uc.has(id));
    // Фильтруем только те что реально есть в statements
    const stmtMap = new Map(statements.map(s => [s.id, s]));
    return commonIds
      .map(id => stmtMap.get(id))
      .filter(Boolean);
  };

  const openChat = async (matchUser) => {
    setActiveChat(matchUser);
    setShowCommon(false);
    setNewMessageDot(false);
    setScreen("chat");
    const chatId = [user.uid, matchUser.id].sort().join("_");
    const commonRef = doc(db, "chats", chatId, "meta", "common");
    // load saved from Firestore
    const commonSnap = await getDoc(commonRef);
    const saved = commonSnap.exists() ? (commonSnap.data().statements || []) : [];
    if (saved.length > 0) {
      // Есть сохранённые — показываем их + добавляем новые совпадения
      const current = getCommonStatements(matchUser).map(s => ({ id: s.id, text: s.text, author: s.author }));
      const savedIds = new Set(saved.map(s => s.id));
      const newOnes = current.filter(s => !savedIds.has(s.id));
      const merged = [...saved, ...newOnes];
      setActiveChatCommon(merged);
      if (newOnes.length > 0) {
        await setDoc(commonRef, { statements: merged });
      }
      setSavedCommonCounts(prev => ({ ...prev, [matchUser.id]: merged.length }));
    } else {
      // Нет сохранённых — вычисляем текущие
      const current = getCommonStatements(matchUser).map(s => ({ id: s.id, text: s.text, author: s.author }));
      setActiveChatCommon(current);
      if (current.length > 0) {
        await setDoc(commonRef, { statements: current });
      }
      setSavedCommonCounts(prev => ({ ...prev, [matchUser.id]: current.length }));
    }
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
              <Feed
                user={user}
                nickname={nickname}
                isBlocked={isBlocked}
                statements={statements}
                setStatements={setStatements}
                clicked={clicked}
                setClicked={setClicked}
                reported={reported}
                setReported={setReported}
                matches={matches}
                allUsers={allUsers}
                searchQuery={searchQuery}
                lastStmtDoc={lastStmtDoc}
                setLastStmtDoc={setLastStmtDoc}
                hasMoreStmts={hasMoreStmts}
                setHasMoreStmts={setHasMoreStmts}
                onReport={(id) => setModal({type:"report",id})}
                onNotif={showNotif}
              />
            )}

            {/* MATCHES */}
            {screen==="matches" && (
              <Matches
                matches={matches}
                filteredMatches={filteredMatches}
                searchQuery={searchQuery}
                useLocation={useLocation}
                savedLocation={savedLocation}
                onOpenChat={openChat}
              />
            )}

            {/* MESSAGES */}
            {screen==="messages" && (
              <Messages
                user={user}
                chatList={chatList}
                searchQuery={searchQuery}
                savedCommonCounts={savedCommonCounts}
                onOpenChat={openChat}
              />
            )}

            {/* ADMIN */}
            {screen==="admin" && user.uid === ADMIN_UID && (
              <Admin
                statements={statements}
                allUsers={allUsers}
                onNotif={showNotif}
              />
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
