import { useRef, useEffect } from "react";

export default function Chat({
  user, activeChat, chatMessages, chatInput, setChatInput,
  activeChatCommon, showCommon, setShowCommon,
  onSend, onResetCommon, onBack,
}) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div className="chat-body">
      <div className="chat-msgs">
        {chatMessages.length === 0 ? (
          <div className="empty"><p>no messages yet<br/>say hello</p></div>
        ) : chatMessages.map((msg, i) => (
          <div key={i} className={`msg ${msg.from === user.uid ? "you" : "them"}`}>
            {msg.from !== user.uid && <div className="msg-sender">{msg.fromNick}</div>}
            <div className="msg-text">{msg.text}</div>
          </div>
        ))}
        <div ref={chatEndRef}/>
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="write a message…"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSend()}
        />
        <button className="send-btn" onClick={onSend}>↑</button>
      </div>
    </div>
  );
}
