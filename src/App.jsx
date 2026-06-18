import { useState, useEffect, useRef } from "react";
import {
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  addDoc,
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
import Philosophy from "./components/Philosophy";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import Feed from "./components/Feed";
import { computeLiveCommon } from "./lib/common";
import { useStatements } from "./hooks/useStatements";
import { useMatches } from "./hooks/useMatches";
import { useChat } from "./hooks/useChat";
import { useActiveChat } from "./hooks/useActiveChat";
import Matches from "./components/Matches";
import Messages from "./components/Messages";



export default function App() {

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("feed");
  const [nickname, setNickname] = useState("");
  const [clicked, setClicked] = useState(new Set());
  const [reported, setReported] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const PAGE_SIZE = 20;
  const [modal, setModal] = useState(null);
  const [showLogoutMenu, setShowLogoutMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showPhilosophy, setShowPhilosophy] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [savedLocation, setSavedLocation] = useState(null);
  const [useLocation, setUseLocation] = useState(false);
  const [savedAge, setSavedAge] = useState(null);
  const [savedAgeMin, setSavedAgeMin] = useState(null);
  const [savedAgeMax, setSavedAgeMax] = useState(null);
  const [useAge, setUseAge] = useState(false);
  const [notification, setNotification] = useState(null);
  const [notifKey, setNotifKey] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [completeNickInput, setCompleteNickInput] = useState("");


  const showNotif = (msg) => { setNotification(msg); setNotifKey(k => k + 1); };

  // HOOKS
  const { statements, setStatements, lastStmtDoc, setLastStmtDoc, hasMoreStmts, setHasMoreStmts } = useStatements(user);
  const { matches, setMatches, newMatchDot, setNewMatchDot, fetchMatches } = useMatches(user, useLocation, useAge, showNotif);
  const { chatList, savedCommonCounts, setSavedCommonCounts, newMessageDot, setNewMessageDot } = useChat(user);
  const {
    activeChat,
    activeChatCommon, setActiveChatCommon,
    chatMessages,
    chatInput, setChatInput,
    showCommon, setShowCommon,
    openChat, sendMessage,
  } = useActiveChat(user, nickname, clicked, statements, { setScreen, setNewMessageDot, setSavedCommonCounts, showNotif });

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
          const d = snap.data();
          if (d.location) setSavedLocation(d.location);
          setUseLocation(d.useLocation === true);
          if (d.age != null) setSavedAge(d.age);
          if (d.ageMin != null) setSavedAgeMin(d.ageMin);
          if (d.ageMax != null) setSavedAgeMax(d.ageMax);
          setUseAge(d.useAge === true);
          if (d.onboardingDone !== true) setShowOnboarding(true);
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
      setShowOnboarding(true);
    } catch (e) {
      // retry on next login
      await signOut(auth);
      setProfileIncomplete(false);
    }
  };





  const openProfile = () => setShowProfile(true);
  const closeProfile = () => setShowProfile(false);

  const finishOnboarding = async () => {
    setShowOnboarding(false);
    if (user) {
      try { await updateDoc(doc(db, "users", user.uid), { onboardingDone: true }); }
      catch (e) { console.error(e); }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowLogoutMenu(false);
    setScreen("feed");
  };

  // DATA














  // ACTIONS
  const confirmReport = async () => {
    const id = modal.id;
    setReported(prev => new Set([...prev, id]));
    setModal(null);
    try {
      await updateDoc(doc(db, "statements", id), { reports: increment(1) });
      showNotif("Report submitted — thank you");
    } catch (e) {
      console.error("report error:", e);
      setReported(prev => { const n = new Set(prev); n.delete(id); return n; });  // откат
      showNotif("Couldn't submit report — try again");
    }
  };



  const confirmReset = async (fromCommon = false) => {
    if (fromCommon) {
      // reset = пересчёт реального текущего пересечения (НЕ обнуление):
      // оставляем только утверждения, которые ПРЯМО СЕЙЧАС выбраны обоими.
      setModal(null);
      if (!activeChat) return;
      const chatId = [user.uid, activeChat.id].sort().join("_");
      try {
        // reset = ЗАМЕНА на текущее реальное пересечение (обрезает устаревшие).
        const current = await computeLiveCommon(activeChat.id, clicked, statements);
        setActiveChatCommon(current);
        await setDoc(
          doc(db, "user_chats", user.uid, "chats", chatId),
          { commonStatements: current, common: current.length },
          { merge: true }
        );
        setSavedCommonCounts(prev => ({ ...prev, [activeChat.id]: current.length }));
        showNotif("Common ground refreshed");
      } catch (e) {
        console.error("reset common error:", e);
        showNotif("Couldn't refresh — try again");
      }
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
      showNotif("Couldn't reset — try again");
    }
  };


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

      {showOnboarding && <Onboarding onDone={finishOnboarding} />}

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
            useAge={useAge}
            setUseAge={setUseAge}
            savedAge={savedAge}
            setSavedAge={setSavedAge}
            savedAgeMin={savedAgeMin}
            setSavedAgeMin={setSavedAgeMin}
            savedAgeMax={savedAgeMax}
            setSavedAgeMax={setSavedAgeMax}
            onNotif={showNotif}
            onClose={closeProfile}
            onLogout={handleLogout}
            onResetMap={() => setModal({type:"reset",fromCommon:false})}
          />
        )}

        {/* PHILOSOPHY PANEL */}
        {showPhilosophy && user && (
          <Philosophy onClose={() => setShowPhilosophy(false)} />
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
                <div className="nav-logo" style={{cursor:"pointer"}} onClick={(e) => { e.stopPropagation(); if(showProfile) closeProfile(); setShowPhilosophy(v => !v); }}>
                  H

                </div>
<div style={{fontSize:9,color:"#ddd",letterSpacing:1,position:"absolute",left:24,bottom:14}}>v2.6</div>
                <div className="nav-nick" style={{cursor:"pointer"}} onClick={(e) => { e.stopPropagation(); if(showProfile) closeProfile(); else openProfile(); }}>{nickname}</div>
              </div>
              <div className="nav-tabs">
                <button className={`nav-tab ${screen==="feed"?"active":""}`} onClick={() => { setScreen("feed"); setSearchQuery(""); }}>
                  Statements
                </button>
                <button className={`nav-tab ${screen==="matches"?"active":""}`} onClick={() => { setScreen("matches"); setSearchQuery(""); setNewMatchDot(false); fetchMatches(); }}>
                  Matches {newMatchDot && screen!=="matches" && <span className="nav-dot"/>}
                </button>
                <button className={`nav-tab ${screen==="messages"?"active":""}`} onClick={() => { setScreen("messages"); setSearchQuery(""); setNewMessageDot(false); }}>
                  Messages {newMessageDot && screen!=="messages" && <span className="nav-dot"/>}
                </button>

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
                useLocation={useLocation}
                savedLocation={savedLocation}
                useAge={useAge}
                onOpenChat={openChat}
              />
            )}

            {/* MESSAGES */}
            {screen==="messages" && (
              <Messages
                user={user}
                chatList={chatList}
                savedCommonCounts={savedCommonCounts}
                onOpenChat={openChat}
              />
            )}

            {/* ADMIN */}




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
