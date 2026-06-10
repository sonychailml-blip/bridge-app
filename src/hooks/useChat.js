import { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export function useChat(user, allUsers, matches) {
  const [chatList, setChatList] = useState([]);
  const [savedCommonCounts, setSavedCommonCounts] = useState({});
  const [newMessageDot, setNewMessageDot] = useState(false);

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

  // chat list — listens to all users
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

  return { chatList, savedCommonCounts, setSavedCommonCounts, newMessageDot, setNewMessageDot };
}
