import { useState, useEffect } from "react";
import { doc, onSnapshot, collection, query, where, documentId, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const REPORT_THRESHOLD = 3;

// Рекомендации считаются сервером (computeRecommendations) и лежат в users/{uid}.recommendations
// как упорядоченный массив id. Здесь: подписываемся на user-док (реки обновляются фоном после
// пересчёта) и грузим доки этих утверждений по id, сохраняя порядок рекомендаций.
export function useRecommendations(user) {
  const [recIds, setRecIds] = useState([]);
  const [recommendedStatements, setRecommendedStatements] = useState([]);

  // подписка на user-док → массив id рекомендаций
  useEffect(() => {
    if (!user) { setRecIds([]); return; }
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setRecIds(snap.exists() ? (snap.data().recommendations || []) : []);
    });
    return unsub;
  }, [user]);

  // грузим доки рекомендованных утверждений (их обычно нет в обычном фиде — он отдаёт только
  // последние 20 по ts), сохраняя порядок и отсеивая удалённые/зарепорченные
  useEffect(() => {
    if (!user || recIds.length === 0) { setRecommendedStatements([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const byId = {};
        for (let i = 0; i < recIds.length; i += 30) {        // лимит "in" = 30
          const chunk = recIds.slice(i, i + 30);
          const snap = await getDocs(query(collection(db, "statements"), where(documentId(), "in", chunk)));
          snap.docs.forEach(d => { byId[d.id] = { id: d.id, ...d.data() }; });
        }
        if (cancelled) return;
        const ordered = recIds
          .map(id => byId[id])
          .filter(Boolean)
          .filter(s => (s.reports || 0) < REPORT_THRESHOLD);
        setRecommendedStatements(ordered);
      } catch (e) {
        console.error("useRecommendations load error:", e);
        if (!cancelled) setRecommendedStatements([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, recIds.join(",")]);

  return { recommendedStatements };
}
