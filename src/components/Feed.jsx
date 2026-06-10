import { useState, useRef, useEffect } from "react";
import {
  collection, addDoc, query, orderBy, limit, startAfter,
  getDocs, doc, updateDoc, increment, arrayUnion, arrayRemove,
  serverTimestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

const BANNED_WORDS = ["drugs","cocaine","heroin","buy weed","sell drugs","murder","terrorism"];
const REPORT_THRESHOLD = 3;
const MONTH = 30 * 24 * 3600000;

export default function Feed({
  user, nickname, isBlocked,
  statements, setStatements,
  clicked, setClicked,
  reported, setReported,
  matches, allUsers,
  searchQuery,
  lastStmtDoc, setLastStmtDoc,
  hasMoreStmts, setHasMoreStmts,
  onReport, onNotif,
}) {
  const [newStatement, setNewStatement] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const suggestionsRef = useRef(null);
  const feedEndRef = useRef(null);

  // close suggestions on click outside
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // infinite scroll
  useEffect(() => {
    if (!feedEndRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreStatements(); },
      { threshold: 0.1 }
    );
    observer.observe(feedEndRef.current);
    return () => observer.disconnect();
  }, [lastStmtDoc, hasMoreStmts, loadingMore]);

  // search — через сервер, сортировка по популярности
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const fns = getFunctions(undefined, "europe-west1");
        const searchFn = httpsCallable(fns, "searchStatements");
        const result = await searchFn({ query: searchQuery, limit: 50 });
        const blockedUserIds = new Set(allUsers.filter(u => u.blocked).map(u => u.id));
        const results = result.data.results
          .filter(s => !reported.has(s.id))
          .filter(s => !blockedUserIds.has(s.authorId));
        setSearchResults(results);
      } catch(e) {
        console.error("search error:", e);
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  const toggleClick = async (id) => {
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
      onNotif("Added to your map");
    }
  };

  const addStatement = async () => {
    if (!newStatement.trim()) return;
    if (isBlocked) { onNotif("Your account has been suspended"); return; }
    if (BANNED_WORDS.some(w => newStatement.toLowerCase().includes(w))) {
      onNotif("This violates our guidelines"); return;
    }
    const duplicate = statements.some(s => s.text.toLowerCase().trim() === newStatement.toLowerCase().trim());
    if (duplicate) { onNotif("This statement already exists"); return; }
    const ref = await addDoc(collection(db, "statements"), {
      text: newStatement.trim(), author: nickname, authorId: user.uid,
      clicks: 1, reports: 0, ts: serverTimestamp(),
    });
    setClicked(prev => new Set([...prev, ref.id]));
    await updateDoc(doc(db, "users", user.uid), { clicked: arrayUnion(ref.id) });
    setNewStatement("");
    onNotif("Statement published");
  };

  // smart sort
  const matchUserIds = new Set(matches.map(m => m.id));
  const blockedUserIds = new Set(allUsers.filter(u => u.blocked).map(u => u.id));
  const sortedStatements = [...statements]
    .filter(s => !reported.has(s.id))
    .filter(s => !blockedUserIds.has(s.authorId))
    .sort((a, b) => {
      if (searchQuery.trim()) return (b.clicks||0) - (a.clicks||0);
      const aM = matchUserIds.has(a.authorId), bM = matchUserIds.has(b.authorId);
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return 0;
    });

  const displayList = searchResults ?? sortedStatements;

  return (
    <>
      <div className="search-bar">
        <input className="search-input" placeholder="write a statement about yourself… or search"
          value={newStatement}
          onChange={e => {
            const val = e.target.value;
            setNewStatement(val);
            if (val.trim().length > 2) {
              try {
                const fns = getFunctions(undefined, "europe-west1");
                const searchFn = httpsCallable(fns, "searchStatements");
                const result = await searchFn({ query: val, limit: 10 });
                const found = result.data.results
                  .filter(s => s.text.toLowerCase() !== val.toLowerCase());
                setSuggestions(found);
              } catch(e) {
                setSuggestions([]);
              }
            } else {
              setSuggestions([]);
            }
          }}
          onKeyDown={e => { if(e.key === "Enter") { addStatement(); setSuggestions([]); } }}
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
        {!searchLoading && displayList.length === 0 && (
          <div className="empty"><p>{searchQuery ? "nothing found" : "no statements yet"}<br/>{!searchQuery && "be the first to write one"}</p></div>
        )}
        {!searchLoading && displayList.map(s => (
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
                  onClick={e => { e.stopPropagation(); onReport(s.id); }}>
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
  );
}
