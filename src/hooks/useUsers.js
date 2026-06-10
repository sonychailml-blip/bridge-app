import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export function useUsers(user) {
  const [allUsers, setAllUsers] = useState([]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.id !== user.uid));
    });
    return unsub;
  }, [user]);

  return { allUsers };
}
