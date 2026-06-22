import { useState, useRef, useEffect } from "react";
import {
  collection, query, orderBy, limit, startAfter,
  getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

const BANNED_WORDS = ["drugs","cocaine","heroin","buy weed","sell drugs","murder","terrorism"];
const REPORT_THRESHOLD = 3;
const MONTH = 30 * 24 * 3600000;

export default function Feed({
  user, nickname, isBlocked,
  statements, setStatements,
  recommendedStatements = [],
  clicked, setClicked,
  reported, setReported,
  matches,
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
        const results = result.data.results
          .filter(s => !reported.has(s.id));
        setSearchResults(results);
      } catch(e) {
        console.error("search error:", e);
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // suggestions — debounced; раньше дёргали сервер на каждое нажатие, из-за чего тормозил Enter
  useEffect(() => {
    if (newStatement.trim().length <= 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const fns = getFunctions(undefined, "europe-west1");
        const searchFn = httpsCallable(fns, "searchStatements");
        const result = await searchFn({ query: newStatement, limit: 10 });
        setSuggestions(result.data.results.filter(s => s.text.toLowerCase() !== newStatement.toLowerCase()));
      } catch(e) {
        setSuggestions([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [newStatement]);

  const loadMoreStatements = async () => {
    if (!lastStmtDoc || !hasMoreStmts || loadingMore) return;
    setLoadingMore(true);
    try {
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
    } catch (e) {
      console.error("loadMoreStatements error:", e);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleClick = async (id) => {
    if (window._longPressed) { window._longPressed = false; return; }
    const wasClicked = clicked.has(id);
    const action = wasClicked ? "remove" : "add";
    // снимки для отката при ошибке
    const prevClicked = clicked;
    const prevClicks = statements.find(s => s.id === id)?.clicks;

    // оптимистично обновляем UI
    if (wasClicked) {
      setClicked(prev => { const n = new Set(prev); n.delete(id); return n; });
      setStatements(prev => prev.map(s => s.id === id ? { ...s, clicks: Math.max(0, (s.clicks||0) - 1) } : s));
    } else {
      setClicked(prev => new Set([...prev, id]));
      setStatements(prev => prev.map(s => s.id === id ? { ...s, clicks: (s.clicks||0) + 1 } : s));
      onNotif("Added to your statements");
    }

    try {
      const fns = getFunctions(undefined, "europe-west1");
      const toggleClickFn = httpsCallable(fns, "toggleClick");
      const res = await toggleClickFn({ statementId: id, action });
      // Сервер решает по умному расписанию, пора ли пересчитать рекомендации.
      // Дёргаем пересчёт fire-and-forget (НЕ await) — клик остаётся быстрым,
      // реки обновятся фоном (подписка в useRecommendations подхватит).
      if (res?.data?.recompute) {
        httpsCallable(fns, "computeRecommendations")()
          .catch(err => console.error("computeRecommendations trigger error:", err));
      }
    } catch (e) {
      console.error("toggleClick error:", e);
      // откат оптимистичных изменений к прежнему состоянию
      setClicked(new Set(prevClicked));
      setStatements(prev => prev.map(s => s.id === id ? { ...s, clicks: prevClicks ?? s.clicks } : s));
      onNotif("Couldn't save — try again");
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
    if (newStatement.trim().length > 200) { onNotif("Statement too long — max 200 characters"); return; }
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const createStatement = httpsCallable(fns, "createStatement");
      const result = await createStatement({ text: newStatement.trim() });
      setClicked(prev => new Set([...prev, result.data.id]));
      setNewStatement("");
      onNotif("Statement published");
    } catch (e) {
      if (e.code === "functions/resource-exhausted") {
        onNotif(e.message);
      } else {
        console.error("createStatement error:", e);
        onNotif("Could not publish statement");
      }
    }
  };

  // smart sort
  const matchUserIds = new Set(matches.map(m => m.id));
  const sortedStatements = [...statements]
    .filter(s => !reported.has(s.id))
    .sort((a, b) => {
      if (searchQuery.trim()) return (b.clicks||0) - (a.clicks||0);
      const aM = matchUserIds.has(a.authorId), bM = matchUserIds.has(b.authorId);
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return 0;
    });

  // Рекомендации доминируют в фиде (когда не идёт поиск и они есть).
  // Обычные утверждения — минимальный «филлер» снизу, без дублей рекомендаций.
  // Фолбэк: нет рекомендаций (новый юзер / пусто) → обычный фид как раньше.
  const hasRecs = !searchQuery.trim() && recommendedStatements.length > 0;
  const recIdSet = new Set(recommendedStatements.map(s => s.id));
  const recList = recommendedStatements.filter(s => !reported.has(s.id));
  const fillerStatements = sortedStatements.filter(s => !recIdSet.has(s.id));

  // единый рендер карточки утверждения
  const renderStmt = (s) => (
    <div key={s.id} className="stmt" onClick={() => toggleClick(s.id)}>
      <div className="stmt-left">
        <div className={`stmt-text ${clicked.has(s.id)?"on":""}`}>{s.text}</div>
        <div className="stmt-meta">{s.author}</div>
      </div>
      <div className="stmt-right">
        <div className={`dot ${clicked.has(s.id)?"on":""}`}/>
        <div className="cnt">{Math.max(0, s.clicks||0).toLocaleString()}</div>
        {/* report button hidden — re-enable by changing `false &&` back to the original condition. Report logic is intact. */}
        {false && s.authorId !== user.uid && !reported.has(s.id) && (
          <button className="r-btn" onClick={e => { e.stopPropagation(); onReport(s.id); }}>r</button>
        )}
        {false && reported.has(s.id) && <span className="r-done">r</span>}
      </div>
    </div>
  );

  return (
    <>
      <div className="search-bar">
        <div className="statement-row">
        <input className="search-input" placeholder="write a statement about yourself… or search"
          value={newStatement}
          onChange={e => setNewStatement(e.target.value)}
          onKeyDown={e => { if(e.key === "Enter") { addStatement(); setSuggestions([]); } }}
        />
        <button className="btn btn-primary" onClick={addStatement}>Publish</button>
        </div>
        {newStatement.length > 0 && (
          <div style={{textAlign:"right",fontSize:10,letterSpacing:1,marginTop:4,color: newStatement.length > 200 ? "#c0392b" : "#ccc"}}>
            {newStatement.length}/200
          </div>
        )}
        {suggestions.length > 0 && (
          <div ref={suggestionsRef} style={{borderTop:"1px solid #f5f5f5",marginTop:8}}>
            <div style={{padding:"8px 0 4px",fontSize:9,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>similar statements</div>
            <div style={{maxHeight:280,overflowY:"auto"}}>
              {suggestions.map(s => (
                <div key={s.id}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #f5f5f5",cursor:"pointer",gap:12}}
                  onClick={() => { toggleClick(s.id); }}
                >
                  <div style={{fontSize:13,color:"#111",flex:1,lineHeight:1.4,fontFamily:"'Noto Sans',system-ui,-apple-system,'Segoe UI',sans-serif",overflowWrap:"break-word",wordBreak:"break-word",minWidth:0}}>{s.text}</div>
                  <div style={{fontSize:10,color:"#ccc",flexShrink:0}}>{(s.clicks||0).toLocaleString()}</div>
                  <div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:clicked.has(s.id)?"#111":"transparent",border:clicked.has(s.id)?"1px solid #111":"1px solid #ccc"}}/>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="feed-section">
        {searchLoading && <div style={{padding:"24px 0",textAlign:"center",fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>searching…</div>}

        {/* ПОИСК */}
        {!searchLoading && searchResults && (
          searchResults.length === 0
            ? <div className="empty"><p>nothing found</p></div>
            : searchResults.map(renderStmt)
        )}

        {/* РЕКОМЕНДАЦИИ доминируют, обычный фид — минимальный филлер снизу */}
        {!searchLoading && !searchResults && hasRecs && (
          <>
            <div className="rec-label">for you</div>
            {recList.map(renderStmt)}
            {fillerStatements.length > 0 && (
              <>
                <div className="rec-label rec-label-more">more</div>
                {fillerStatements.map(renderStmt)}
              </>
            )}
          </>
        )}

        {/* ФОЛБЭК: нет рекомендаций → обычный фид как раньше */}
        {!searchLoading && !searchResults && !hasRecs && (
          sortedStatements.length === 0
            ? <div className="empty"><p>no statements yet<br/>be the first to write one</p></div>
            : sortedStatements.map(renderStmt)
        )}

        {!searchLoading && !searchResults && hasMoreStmts && (
          <div ref={feedEndRef} style={{padding:"16px 0",textAlign:"center"}}>
            {loadingMore && <span style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#ccc"}}>loading…</span>}
          </div>
        )}
      </div>
    </>
  );
}
