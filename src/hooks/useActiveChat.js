import { useState, useEffect } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import { computeLiveCommon } from "../lib/common";

export function useActiveChat(user, nickname, clicked, statements, { setScreen, setNewMessageDot, setSavedCommonCounts, showNotif }) {
  const [activeChat, setActiveChat] = useState(null);
  const [activeChatCommon, setActiveChatCommon] = useState([]); // cached common for active chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showCommon, setShowCommon] = useState(false);

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

  const openChat = async (matchUser) => {
    // matchUser может прийти из Matches (с commonStatements) или из chatList (с withUid)
    const chatUser = matchUser.withUid ? {
      id: matchUser.withUid,
      nickname: matchUser.withNick,
      commonStatements: [],
    } : matchUser;

    setActiveChat(chatUser);
    setShowCommon(false);
    setNewMessageDot(false);
    setScreen("chat");

    // Помечаем чат как прочитанный
    const chatId = [user.uid, chatUser.id].sort().join("_");
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const markRead = httpsCallable(fns, "markChatRead");
      markRead({ chatId });
    } catch(e) {}

    // 1. История — личный снимок в собственном user_chats-доке (правила: только владелец)
    const personalRef = doc(db, "user_chats", user.uid, "chats", chatId);
    const summarySnap = await getDoc(personalRef);
    const saved = summarySnap.exists() ? (summarySnap.data().commonStatements || []) : [];
    const savedIds = new Set(saved.map(s => s.id));

    // 2. Текущее реальное пересечение (объективно; работает и из Matches, и из Messages)
    let current = [];
    try {
      current = await computeLiveCommon(chatUser.id, clicked, statements);
    } catch (e) {
      console.error("openChat computeLiveCommon error:", e);
    }

    // 3. Добавляем только НОВЫЕ (которых ещё нет в истории); историю не трогаем
    const newOnes = current.filter(s => !savedIds.has(s.id));
    const merged = newOnes.length > 0 ? [...saved, ...newOnes] : saved;

    setActiveChatCommon(merged);
    // merge:true — не затираем withUid/lastMsg/lastTs/unread. Не создаём пустой
    // док для свежего чата без сообщений и без общего (иначе лишний скрытый док).
    if (newOnes.length > 0 || summarySnap.exists()) {
      await setDoc(personalRef, { commonStatements: merged, common: merged.length }, { merge: true });
    }
    setSavedCommonCounts(prev => ({ ...prev, [chatUser.id]: merged.length }));
  };

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const sendMsg = httpsCallable(fns, "sendMessage");
      await sendMsg({
        toUid: activeChat.id,
        text,
        fromNick: nickname,
        toNick: activeChat.nickname,
        common: activeChatCommon.length,
      });
    } catch(e) {
      if (e.code === "functions/resource-exhausted") {
        showNotif?.(e.message);
      } else {
        console.error("sendMessage error:", e);
      }
    }
  };

  return {
    activeChat,
    setActiveChat,
    activeChatCommon,
    setActiveChatCommon,
    chatMessages,
    chatInput,
    setChatInput,
    showCommon,
    setShowCommon,
    openChat,
    sendMessage,
  };
}
