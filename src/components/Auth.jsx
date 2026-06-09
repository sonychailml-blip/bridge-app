import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  reload,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, db } from "../firebase";

export default function Auth({ onLogin }) {
  const [authScreen, setAuthScreen] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [authError, setAuthError] = useState("");

  const handleRegister = async () => {
    setAuthError("");
    if (nicknameInput.trim().length < 2) { setAuthError("Nickname too short"); return; }
    if (password !== password2) { setAuthError("Passwords don't match"); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      await setDoc(doc(db, "users", cred.user.uid), {
        nickname: nicknameInput.trim(), clicked: [], ts: serverTimestamp(),
      });
      await signOut(auth);
      setAuthScreen("verify");
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleLogin = async () => {
    setAuthError("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await reload(cred.user);
      if (!cred.user.emailVerified) {
        await signOut(auth);
        setAuthError("Please verify your email first. Check your inbox.");
        return;
      }
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setAuthError("Enter your email first"); return; }
    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(auth, email.trim());
      setAuthError("");
      setAuthScreen("resetSent");
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  const handleGoogle = async () => {
    setAuthError("");
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      if (!snap.exists()) {
        const nick = cred.user.displayName?.split(" ")[0]?.toLowerCase() || "user" + Date.now();
        await setDoc(doc(db, "users", cred.user.uid), { nickname: nick, clicked: [], ts: serverTimestamp() });
      }
    } catch (e) { setAuthError(e.message.replace("Firebase: ", "")); }
  };

  return (
    <>
      {authScreen === "login" && (
        <div className="auth">
          <div className="auth-logo">H</div>
          <div className="auth-tagline">find your people</div>
          <input className="auth-input" placeholder="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="auth-input" placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
          {authError && <div className="auth-error">{authError}</div>}
          <button className="auth-btn" onClick={handleLogin}>Sign in</button>
          <button className="auth-btn secondary" onClick={handleGoogle}>Continue with Google</button>
          <div className="auth-switch">No account? <span onClick={() => { setAuthScreen("register"); setAuthError(""); }}>Create one</span></div>
          <div className="auth-switch" style={{marginTop:8}}>Forgot password? <span onClick={handleForgotPassword}>Reset it</span></div>
          <div className="auth-notice">
            <strong>H is open by design.</strong><br />
            Your statements and nickname are visible to everyone.<br />
            For privacy, take conversations to your own messengers.
          </div>
        </div>
      )}

      {authScreen === "register" && (
        <div className="auth">
          <div className="auth-logo">H</div>
          <div className="auth-tagline">create account</div>
          <input className="auth-input" placeholder="nickname (visible to others)" value={nicknameInput} onChange={e => setNicknameInput(e.target.value)} />
          <input className="auth-input" placeholder="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="auth-input" placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <input className="auth-input" placeholder="confirm password" type="password" value={password2} onChange={e => setPassword2(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRegister()} />
          {authError && <div className="auth-error">{authError}</div>}
          <button className="auth-btn" onClick={handleRegister}>Create account</button>
          <button className="auth-btn secondary" onClick={handleGoogle}>Continue with Google</button>
          <div className="auth-switch">Have an account? <span onClick={() => { setAuthScreen("login"); setAuthError(""); }}>Sign in</span></div>
        </div>
      )}

      {authScreen === "resetSent" && (
        <div className="auth">
          <div className="auth-logo">H</div>
          <div className="verify-text">
            Check your email —<br />we sent a password reset link.<br /><br />
            After resetting, come back and sign in.
          </div>
          <button className="auth-btn" onClick={() => { setAuthScreen("login"); setAuthError(""); }}>Go to sign in</button>
        </div>
      )}

      {authScreen === "verify" && (
        <div className="auth">
          <div className="auth-logo">H</div>
          <div className="verify-text">Check your email and confirm your address.<br /><br />Then come back and sign in.</div>
          <button className="auth-btn" onClick={() => setAuthScreen("login")}>Go to sign in</button>
        </div>
      )}
    </>
  );
}
