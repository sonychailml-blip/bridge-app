import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

// Текущее реальное пересечение: что ПРЯМО СЕЙЧАС выбрано обоими.
// Возвращает [{id,text,author,clicks}]. Данные берём из локального фида,
// иначе дочитываем; несуществующие (удалённые/истёкшие) пропускаем.
export async function computeLiveCommon(otherUid, myClicked, statements) {
  const otherSnap = await getDoc(doc(db, "users", otherUid));
  const otherClicked = otherSnap.exists() ? (otherSnap.data().clicked || []) : [];
  const otherSet = new Set(otherClicked);
  const commonIds = [...myClicked].filter(id => otherSet.has(id));

  const localById = new Map(statements.map(s => [s.id, s]));
  const result = [];
  for (const id of commonIds) {
    const local = localById.get(id);
    if (local) {
      result.push({ id, text: local.text, author: local.author, clicks: local.clicks || 0 });
      continue;
    }
    const sSnap = await getDoc(doc(db, "statements", id));
    if (sSnap.exists()) {
      const d = sSnap.data();
      result.push({ id, text: d.text, author: d.author, clicks: d.clicks || 0 });
    }
  }
  // Сортируем по значимости: реже (меньше кликов) = выше вес = выше в списке —
  // консистентно с getMatches.
  result.sort((a, b) => (a.clicks || 0) - (b.clicks || 0));
  return result;
}
