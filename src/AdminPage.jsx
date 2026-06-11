import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import Admin from "./components/Admin";
import "./App.css";

const ADMIN_UID = "ezPSAlWRjZbqGGTIzWK2LRqLgR12";

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [statements, setStatements] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [notification, setNotification] = useState(null);
  const [notifKey, setNotifKey] = useState(0);

  const showNotif = (msg) => {
    setNotification(msg);
    setNotifKey(k => k + 1);
    setTimeout(() => setNotification(null), 2200);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user || user.uid !== ADMIN_UID) return;
    const unsub1 = onSnapshot(collection(db, "statements"), snap => {
      setStatements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsub2 = onSnapshot(collection(db, "users"), snap => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.id !== user.uid));
    });
    return () => { unsub1(); unsub2(); };
  }, [user]);

  if (!user) return (
    <div className="auth">
      <div className="auth-logo">H</div>
      <div className="auth-tagline">loading…</div>
    </div>
  );

  if (user.uid !== ADMIN_UID) return (
    <div className="auth">
      <div className="auth-logo">H</div>
      <div className="auth-tagline">access denied</div>
    </div>
  );

  return (
    <div className="app">
      <div className="nav">
        <div className="nav-top">
          <div className="nav-logo" onClick={() => window.location.href = "/"}>H</div>
        </div>
        <div className="nav-tabs">
          <span style={{fontSize:11,letterSpacing:1.5,textTransform:"uppercase",color:"#bbb",paddingBottom:12}}>
            Admin Panel
          </span>
        </div>
      </div>
      <Admin
        statements={statements}
        allUsers={allUsers}
        onNotif={showNotif}
      />
      {notification && <div className="notif" key={notifKey}>{notification}</div>}
    </div>
  );
}
