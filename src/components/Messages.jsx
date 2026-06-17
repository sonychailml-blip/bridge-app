export default function Messages({
  user, chatList, savedCommonCounts, onOpenChat,
}) {
  return (
    <div className="list-section">
      {chatList.length === 0 ? (
        <div className="empty"><p>no conversations yet<br/>find matches and start writing</p></div>
      ) : chatList.map(c => (
        <div key={c.id} className="list-item" style={{cursor:"pointer"}} onClick={() => onOpenChat(c)}>
          <div className="list-item-left">
            <div className="list-nick">
              {c.unread && <span className="unread-dot"/>}
              {c.withNick}
            </div>
            <div className="list-preview">
              {c.lastMsg ? (c.lastFrom === user.uid ? `You: ${c.lastMsg}` : c.lastMsg) : ""}
            </div>
          </div>
          <div className="list-right">
            <div className="list-overlap">
              <span>{savedCommonCounts[c.withUid] ?? c.common ?? 0}</span> in common
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
