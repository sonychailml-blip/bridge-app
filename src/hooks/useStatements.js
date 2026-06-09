import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const REPORT_THRESHOLD = 3;
const MONTH = 30 * 24 * 3600000;

export function useStatements(user) {
  const [statements, setStatements] = useState([]);
  const [lastStmtDoc, setLastStmtDoc] = useState(null);
  const [hasMoreStmts, setHasMoreStmts] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "statements"), orderBy("ts", "desc"), limit(20));
    const unsub = onSnapshot(q, (snap) => {
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
    });
    return unsub;
  }, [user]);

  return { statements, setStatements, lastStmtDoc, setLastStmtDoc, hasMoreStmts, setHasMoreStmts };
}
