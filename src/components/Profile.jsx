import { useState } from "react";
import { doc, updateDoc, arrayRemove, increment } from "firebase/firestore";
import { db } from "../firebase";

export default function Profile({
  user, nickname, statements, clicked, setClicked, setStatements,
  useLocation, setUseLocation, savedLocation, setSavedLocation,
  onClose, onLogout, onResetMap,
}) {
  const [pendingRemovals, setPendingRemovals] = useState(new Set());
  const [locationInput, setLocationInput] = useState(savedLocation?.name || "");
  const [locationSuggestions, setLocationSuggestions] = useState([]);

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

  const selectLocation = async (loc) => {
    setSavedLocation(loc);
    setLocationInput(loc.name);
    setLocationSuggestions([]);
    setUseLocation(true);
    await updateDoc(doc(db, "users", user.uid), {
      location: { name: loc.name, lat: loc.lat, lng: loc.lng }
    });
  };

  const handleClose = () => {
    if (pendingRemovals.size > 0) {
      const newClicked = new Set([...clicked].filter(id => !pendingRemovals.has(id)));
      setClicked(newClicked);
      setStatements(prev => prev.map(s => pendingRemovals.has(s.id) ? { ...s, clicks: Math.max(0, (s.clicks||0) - 1) } : s));
      pendingRemovals.forEach(async id => {
        try {
          await updateDoc(doc(db, "users", user.uid), { clicked: arrayRemove(id) });
          await updateDoc(doc(db, "statements", id), { clicks: increment(-1) }).catch(()=>{});
        } catch(e) {}
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
  const agreedStatements = statements.filter(s => s.authorId !== user.uid && clicked.has(s.id) && !pendingRemovals.has(s.id));

  return (
    <>
      <div style={{position:"fixed",inset:0,zIndex:24}} onClick={handleClose}/>
      <div className="profile-panel" onClick={e => e.stopPropagation()}>
        <div className="profile-panel-header">
          <div className="profile-panel-title">{nickname}</div>
          <button className="profile-reset-btn" onClick={onLogout}>sign out</button>
        </div>

        {/* LOCATION */}
        <div className="profile-section">
          <input className="loc-input" placeholder="enter your city…"
            value={locationInput}
            onChange={e => { setLocationInput(e.target.value); searchLocation(e.target.value); }}
          />
          {locationSuggestions.length > 0 && (
            <div className="loc-suggestions">
              {locationSuggestions.map((loc, i) => (
                <div key={i} className="loc-suggestion" onClick={() => selectLocation(loc)}>
                  {loc.name}
                </div>
              ))}
            </div>
          )}
          {savedLocation && locationSuggestions.length === 0 && (
            <div className="loc-current">
              <div className="loc-dot"/>
              <span>{savedLocation.name}</span>
            </div>
          )}
          <div className="loc-toggle-row">
            <div className="loc-toggle-label">Use location in Matches</div>
            <div className={`loc-toggle ${useLocation?"":"off"}`} onClick={() => setUseLocation(v => !v)}/>
          </div>
        </div>

        {/* RESET */}
        <div style={{padding:"16px 0",borderBottom:"1px solid #f5f5f5"}}>
          <button className="profile-reset-btn" onClick={() => { onResetMap(); handleClose(); }}>
            reset all statements
          </button>
        </div>

        {/* OWN STATEMENTS */}
        {ownStatements.length > 0 && (
          <div className="profile-section">
            <div className="profile-section-label">Your statements</div>
            {ownStatements.map(s => (
              <div key={s.id} className="profile-stmt" style={{cursor:"pointer"}} onClick={() => toggleRemoval(s.id)}>
                <div>
                  <div className="profile-stmt-text italic">{s.text}</div>
                </div>
                <div className={`profile-stmt-dot ${clicked.has(s.id) && !pendingRemovals.has(s.id) ? "on" : ""}`}/>
              </div>
            ))}
          </div>
        )}

        {/* AGREED STATEMENTS */}
        {agreedStatements.length > 0 && (
          <div className="profile-section">
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
