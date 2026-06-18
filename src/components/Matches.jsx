import { useState } from "react";

export default function Matches({
  matches,
  useLocation, savedLocation, useAge,
  onOpenChat,
}) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="list-section">
      {matches.length === 0 ? (
        <div className="empty"><p>click statements in the feed<br/>to find people who think like you</p></div>
      ) : matches.map(m => (
        <div key={m.id}>
          <div className="list-item">
            <div className="list-item-left">
              <div className="list-nick">{m.nickname}</div>
              <div className="list-sub">
                <button className={`common-toggle ${expandedId===m.id?"on":""}`}
                  onClick={() => setExpandedId(expandedId===m.id ? null : m.id)}>
                  {m.common ?? 0} in common
                </button>
                {(() => {
                  const cityShown = m.location && useLocation && savedLocation;
                  const cityText = cityShown
                    ? (m.location.name.split(',')[0] === savedLocation.name.split(',')[0] ? "same city" : m.location.name.split(',')[0])
                    : null;
                  const ageShown = useAge && m.age != null;
                  const parts = [cityText, ageShown ? String(m.age) : null].filter(Boolean);
                  if (parts.length === 0) return null;
                  return <span style={{marginLeft:8,color:"#ccc"}}>· {parts.join(' · ')}</span>;
                })()}
              </div>
            </div>
            <div className="list-right">
              <button className="write-btn" onClick={() => onOpenChat(m)}>Write</button>
            </div>
          </div>
          <div className={`common-panel ${expandedId===m.id?"open":""}`}>
            <div className="common-inner">
              <div className="common-title">what you share</div>
              {(m.commonStatements || []).length === 0 && (
                <div style={{fontSize:12,color:"#ccc",paddingTop:8}}>no common statements</div>
              )}
              {(m.commonStatements || []).map(s => (
                <div key={s.id} className="common-stmt">
                  <div className="common-stmt-text">{s.text}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:3}}>
                    <span className="common-stmt-author" style={{marginTop:0}}>{s.author}</span>
                    <span style={{fontSize:10,color:"#ccc"}}>{(s.clicks||0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
