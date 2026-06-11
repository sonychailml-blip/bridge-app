import { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export function useChat(user) {
  const [chatList, setChatList] = useState([]);
  const [savedCommonCounts, setSavedCommonCounts] = useState({});
  const [newMessageDot, setNewMessageDot] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Один onSnapshot на коллекцию user_chats/{uid}/chats
    const q = query(
      collection(db, "user_chats", user.uid, "chats"),
      orderBy("lastTs", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setChatList(chats);
      setSavedCommonCounts(prev => {
        const updated = { ...prev };
        chats.forEach(c => { updated[c.withUid] = c.common || 0; });
        return updated;
      });
      if (chats.some(c => c.unread)) setNewMessageDot(true);
    });

    return unsub;
  }, [user]);

  return { chatList, savedCommonCounts, setSavedCommonCounts, newMessageDot, setNewMessageDot };
}
