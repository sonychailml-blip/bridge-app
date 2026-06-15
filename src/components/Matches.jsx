export default function Matches({
  matches, filteredMatches, searchQuery,
  useLocation, savedLocation,
  onOpenChat,
}) {
  return (
    <div className="list-section">
      <div className="section-header">
        <div className="section-sub">people who share your words</div>
      </div>
      {matches.length === 0 ? (
        <div className="empty"><p>click statements in the feed<br/>to find people who think like you</p></div>
      ) : filteredMatches.length === 0 ? (
        <div className="empty"><p>no match found for "{searchQuery}"</p></div>
      ) : filteredMatches.map(m => (
        <div key={m.id} className="list-item">
          <div className="list-item-left">
            <div className="list-nick">{m.nickname}</div>
            <div className="list-sub">
              <span>{m.common}</span> in common
              {(() => {
                const cityShown = m.location && useLocation && savedLocation;
                const cityText = cityShown
                  ? (m.location.name.split(',')[0] === savedLocation.name.split(',')[0] ? "same city" : m.location.name.split(',')[0])
                  : null;
                const parts = [cityText, m.age != null ? String(m.age) : null].filter(Boolean);
                if (parts.length === 0) return null;
                return <span style={{marginLeft:8,color:"#ccc"}}>· {parts.join(' · ')}</span>;
              })()}
            </div>
          </div>
          <div className="list-right">
            <button className="write-btn" onClick={() => onOpenChat(m)}>Write</button>
          </div>
        </div>
      ))}
    </div>
  );
}
