import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

export default function Profile({
  user, nickname, statements, clicked, setClicked, setStatements,
  useLocation, setUseLocation, savedLocation, setSavedLocation,
  useAge, setUseAge, savedAge, setSavedAge,
  savedAgeMin, setSavedAgeMin, savedAgeMax, setSavedAgeMax,
  onClose, onLogout, onResetMap, onNotif,
}) {
  const [pendingRemovals, setPendingRemovals] = useState(new Set());
  const [locationInput, setLocationInput] = useState(savedLocation?.name || "");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [ageInput, setAgeInput] = useState(savedAge != null ? String(savedAge) : "");
  const [ageMinInput, setAgeMinInput] = useState(savedAgeMin != null ? String(savedAgeMin) : "");
  const [ageMaxInput, setAgeMaxInput] = useState(savedAgeMax != null ? String(savedAgeMax) : "");
  const [ageError, setAgeError] = useState("");
  const [locationError, setLocationError] = useState("");

  // Возраст: только целые числа >= 18 (приложение 18+)
  const parseAge = (s) => /^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : NaN;

  const saveAge = async () => {
    const v = parseAge(ageInput);
    if (!Number.isInteger(v) || v < 18) { setAgeError("Age must be a whole number, 18 or older."); return; }
    setAgeError("");
    setSavedAge(v);
    try { await updateDoc(doc(db, "users", user.uid), { age: v }); }
    catch (e) { console.error("saveAge error:", e); }
  };

  const saveAgeMin = async () => {
    const v = parseAge(ageMinInput);
    if (!Number.isInteger(v) || v < 18) { setAgeError("Minimum age must be a whole number, 18 or older."); return; }
    const max = Number.isInteger(parseAge(ageMaxInput)) ? parseAge(ageMaxInput) : savedAgeMax;
    if (max != null && v > max) { setAgeError("Minimum age can't be greater than maximum age."); return; }
    setAgeError("");
    setSavedAgeMin(v);
    try { await updateDoc(doc(db, "users", user.uid), { ageMin: v }); }
    catch (e) { console.error("saveAgeMin error:", e); }
  };

  const saveAgeMax = async () => {
    const v = parseAge(ageMaxInput);
    if (!Number.isInteger(v) || v < 18) { setAgeError("Maximum age must be a whole number, 18 or older."); return; }
    const min = Number.isInteger(parseAge(ageMinInput)) ? parseAge(ageMinInput) : savedAgeMin;
    if (min != null && v < min) { setAgeError("Maximum age can't be less than minimum age."); return; }
    setAgeError("");
    setSavedAgeMax(v);
    try { await updateDoc(doc(db, "users", user.uid), { ageMax: v }); }
    catch (e) { console.error("saveAgeMax error:", e); }
  };

  // Все три поля валидны: целые >= 18 и ageMin <= ageMax
  const ageInputsValid = (a = ageInput, mn = ageMinInput, mx = ageMaxInput) => {
    const av = parseAge(a), mnv = parseAge(mn), mxv = parseAge(mx);
    return Number.isInteger(av) && av >= 18
      && Number.isInteger(mnv) && mnv >= 18
      && Number.isInteger(mxv) && mxv >= 18
      && mnv <= mxv;
  };

  // Если фильтр включён, а данные стали невалидными — выключаем и сохраняем useAge=false
  const autoDisableIfInvalid = (a, mn, mx) => {
    if (useAge && !ageInputsValid(a, mn, mx)) {
      setUseAge(false);
      updateDoc(doc(db, "users", user.uid), { useAge: false }).catch(e => console.error(e));
    }
  };

  const toggleUseAge = async () => {
    if (!useAge) {
      // Включать можно только при полных валидных данных
      if (!ageInputsValid()) {
        setAgeError("Fill in your age and search range (whole numbers, 18+, from ≤ to) before enabling the age filter.");
        return;
      }
      const a = parseAge(ageInput), mn = parseAge(ageMinInput), mx = parseAge(ageMaxInput);
      setAgeError("");
      setSavedAge(a); setSavedAgeMin(mn); setSavedAgeMax(mx);
      setUseAge(true);
      try { await updateDoc(doc(db, "users", user.uid), { age: a, ageMin: mn, ageMax: mx, useAge: true }); }
      catch (e) { console.error("toggleUseAge error:", e); setUseAge(false); onNotif?.("Couldn't save — try again"); }
    } else {
      setUseAge(false);
      try { await updateDoc(doc(db, "users", user.uid), { useAge: false }); }
      catch (e) { console.error("toggleUseAge error:", e); setUseAge(true); onNotif?.("Couldn't save — try again"); }
    }
  };

  const searchLocation = async (query) => {
    if (query.length < 2) { setLocationSuggestions([]); return; }
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        headers: { "Accept-Language": "en", "User-Agent": "HApp/1.0" }
      });
      const data = await res.json();
      setLocationSuggestions(data
        .filter(d => ["city","town","village","municipality"].includes(d.type) || d.addresstype === "city" || d.addresstype === "town")
        .slice(0, 5)
        .map(d => ({
          name: [d.address?.city || d.address?.town || d.address?.village || d.name, d.address?.country].filter(Boolean).join(", "),
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        })));
    } catch(e) { setLocationSuggestions([]); }
  };

  // Выбор города сохраняет только поле location и НЕ включает фильтр —
  // включением/выключением управляет только toggleUseLocation (как saveAge vs toggleUseAge).
  const selectLocation = async (loc) => {
    setSavedLocation(loc);
    setLocationInput(loc.name);
    setLocationSuggestions([]);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        location: { name: loc.name, lat: loc.lat, lng: loc.lng }
      });
    } catch (e) { console.error("selectLocation error:", e); onNotif?.("Couldn't save — try again"); }
  };

  // Если фильтр локации включён, а города нет — выключаем и сохраняем useLocation=false
  const autoDisableLocationIfInvalid = (loc) => {
    if (useLocation && !loc) {
      setUseLocation(false);
      updateDoc(doc(db, "users", user.uid), { useLocation: false }).catch(e => console.error(e));
    }
  };

  const toggleUseLocation = async () => {
    if (!useLocation) {
      // Включать можно только при сохранённом городе
      if (!savedLocation) {
        setLocationError("Set your city before enabling the location filter.");
        return;
      }
      setLocationError("");
      setUseLocation(true);
      try { await updateDoc(doc(db, "users", user.uid), { useLocation: true }); }
      catch (e) { console.error("toggleUseLocation error:", e); setUseLocation(false); onNotif?.("Couldn't save — try again"); }
    } else {
      setUseLocation(false);
      try { await updateDoc(doc(db, "users", user.uid), { useLocation: false }); }
      catch (e) { console.error("toggleUseLocation error:", e); setUseLocation(true); onNotif?.("Couldn't save — try again"); }
    }
  };

  const handleClose = () => {
    if (pendingRemovals.size > 0) {
      const ids = [...pendingRemovals];                 // снимок до сброса state
      const newClicked = new Set([...clicked].filter(id => !pendingRemovals.has(id)));
      setClicked(newClicked);
      setStatements(prev => prev.map(s => pendingRemovals.has(s.id) ? { ...s, clicks: Math.max(0, (s.clicks||0) - 1) } : s));
      // Снимаем клики через серверную функцию (клиент больше не пишет в индекс напрямую).
      // Панель закрывается сразу; вызовы летят в фоне, ошибки только логируем —
      // следующая загрузка фида/матчей отразит фактическое состояние.
      const fns = getFunctions(undefined, "europe-west1");
      const toggleClickFn = httpsCallable(fns, "toggleClick");
      ids.forEach(id => {
        toggleClickFn({ statementId: id, action: "remove" })
          .catch(e => console.error("toggleClick remove error:", e));
      });
      setPendingRemovals(new Set());
    }
    setLocationSuggestions([]);
    onClose();
  };

  const toggleRemoval = (id) => {
    setPendingRemovals(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const ownStatements = statements.filter(s => s.authorId === user.uid && (clicked.has(s.id) || pendingRemovals.has(s.id)));
  const agreedStatements = statements.filter(s => s.authorId !== user.uid && (clicked.has(s.id) || pendingRemovals.has(s.id)));

  return (
    <>
      <div style={{position:"fixed",inset:0,zIndex:24}} onClick={handleClose}/>
      <div className="profile-panel" onClick={e => e.stopPropagation()}>
        <div className="profile-panel-header">
          <div className="profile-panel-title">{nickname}</div>
          <button className="profile-reset-btn" onClick={onLogout}>sign out</button>
        </div>

        {/* LOCATION */}
        <div className="profile-section flush">
          <div className="age-label">Location</div>
          <div className="loc-row">
            <input className="loc-input" placeholder="enter your city…"
              value={locationInput}
              onChange={e => { setLocationInput(e.target.value); searchLocation(e.target.value); }}
            />
            <div className={`loc-toggle ${useLocation?"":"off"}`} onClick={toggleUseLocation}/>
          </div>
          {locationSuggestions.length > 0 && (
            <div className="loc-suggestions">
              {locationSuggestions.map((loc, i) => (
                <div key={i} className="loc-suggestion" onClick={() => selectLocation(loc)}>
                  {loc.name}
                </div>
              ))}
            </div>
          )}
          {locationError && <div className="loc-current" style={{color:"#c00"}}>{locationError}</div>}
        </div>

        {/* AGE */}
        <div className="profile-section">
          <div className="age-row">
            <div className="age-field age-field-own">
              <div className="age-label">Your age</div>
              <input className="loc-input" type="number" min="18"
                value={ageInput}
                onChange={e => { setAgeInput(e.target.value); autoDisableIfInvalid(e.target.value, ageMinInput, ageMaxInput); }}
                onBlur={saveAge}
              />
            </div>
            <div className="age-field age-field-range">
              <div className="age-label">Show me people aged</div>
              <div className="age-range-inputs">
                <input className="loc-input" type="number" min="18"
                  value={ageMinInput}
                  onChange={e => { setAgeMinInput(e.target.value); autoDisableIfInvalid(ageInput, e.target.value, ageMaxInput); }}
                  onBlur={saveAgeMin}
                />
                <span className="age-to">to</span>
                <input className="loc-input" type="number" min="18"
                  value={ageMaxInput}
                  onChange={e => { setAgeMaxInput(e.target.value); autoDisableIfInvalid(ageInput, ageMinInput, e.target.value); }}
                  onBlur={saveAgeMax}
                />
              </div>
            </div>
            <div className="age-field age-field-toggle">
              <div className={`loc-toggle ${useAge?"":"off"}`} onClick={toggleUseAge}/>
            </div>
          </div>
          {ageError && <div className="loc-current" style={{color:"#c00"}}>{ageError}</div>}
        </div>

        {/* RESET */}
        <div style={{padding:"16px 0",borderBottom:"1px solid #f5f5f5"}}>
          <button className="profile-reset-btn" onClick={() => { onResetMap(); handleClose(); }}>
            reset all statements
          </button>
        </div>

        {/* OWN STATEMENTS */}
        {ownStatements.length > 0 && (
          <div className="profile-section flush">
            <div className="profile-section-label">Your statements</div>
            {ownStatements.map(s => (
              <div key={s.id} className="profile-stmt" style={{cursor:"pointer"}} onClick={() => toggleRemoval(s.id)}>
                <div>
                  <div className="profile-stmt-text">{s.text}</div>
                </div>
                <div className={`profile-stmt-dot ${clicked.has(s.id) && !pendingRemovals.has(s.id) ? "on" : ""}`}/>
              </div>
            ))}
          </div>
        )}

        {/* AGREED STATEMENTS */}
        {agreedStatements.length > 0 && (
          <div className="profile-section flush">
            <div className="profile-section-label">Statements you agreed with</div>
            {agreedStatements.map(s => (
              <div key={s.id} className="profile-stmt" style={{cursor:"pointer"}} onClick={() => toggleRemoval(s.id)}>
                <div>
                  <div className="profile-stmt-text">{s.text}</div>
                  <div className="profile-stmt-meta">{s.author}</div>
                </div>
                <div className={`profile-stmt-dot ${clicked.has(s.id) && !pendingRemovals.has(s.id) ? "on" : ""}`}/>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
