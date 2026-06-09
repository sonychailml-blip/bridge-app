export default function Messages({
  user, chatList, searchQuery, savedCommonCounts, onOpenChat,
}) {
  const filtered = chatList.filter(c =>
    searchQuery === "" || c.matchUser.nickname?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="list-section">
      <div className="section-header">
        <div className="section-sub">your conversations</div>
      </div>
      {chatList.length === 0 ? (
        <div className="empty"><p>no conversations yet<br/>find matches and start writing</p></div>
      ) : filtered.map(c => (
        <div key={c.matchUser.id} className="list-item" style={{cursor:"pointer"}} onClick={() => onOpenChat(c.matchUser)}>
          <div className="list-item-left">
            <div className="list-nick">
              {c.unread && <span className="unread-dot"/>}
              {c.matchUser.nickname}
            </div>
            <div className="list-preview">
              {c.lastMsg ? (c.lastMsg.from === user.uid ? `You: ${c.lastMsg.text}` : c.lastMsg.text) : ""}
            </div>
          </div>
          <div className="list-right">
            <div className="list-overlap"><span>{savedCommonCounts[c.matchUser.id] ?? c.matchUser.common}</span> in common</div>
          </div>
        </div>
      ))}
    </div>
  );
}
