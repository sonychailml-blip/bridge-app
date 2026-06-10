import { useState, useEffect } from "react";
import { collection, query, where, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export function useUsers(user) {
  const [allUsers, setAllUsers] = useState([]);

  useEffect(() => {
    if (!user) return;

    // Загружаем только пользователей с хотя бы одним кликом
    // и не заблокированных — максимум 500
    const q = query(
      collection(db, "users"),
      limit(500)
    );

    const unsub = onSnapshot(q, (snap) => {
      setAllUsers(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.id !== user.uid)
      );
    });

    return unsub;
  }, [user]);

  return { allUsers };
}
