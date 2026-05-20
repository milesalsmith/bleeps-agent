import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

/**
 * MilesGPT client — chats with the single global `MilesGPT` DO instance
 * named `"miles"`. Streams over the agents WebSocket protocol via
 * `useAgentChat`.
 */
export function App() {
  const agent = useAgent({
    agent: "MilesGPT",
    name: "miles"
  });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const [input, setInput] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the message list as new chunks stream in.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  };

  const busy = status === "streaming" || status === "submitted";

  return (
    <div className="container">
      <div className="robot-container">
        <img
          src="https://imagedelivery.net/qbHoVdIXIMS_AVA5AS-tUw/ee79919f-44ac-4d00-5506-2fa1770fca00/public"
          alt="Nimbus"
          className="robot-img"
        />
      </div>

      <h1>Welcome to Nimbus</h1>

      <div className="messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="empty">
            Ask Nimbus anything. He remembers across sessions.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="role">{msg.role}</div>
            {msg.parts.map((part, i) =>
              part.type === "text" ? (
                <span key={i}>{part.text}</span>
              ) : null
            )}
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      <div className="status">
        {status === "streaming" && "Nimbus is thinking…"}
        {status === "submitted" && "Sending…"}
        {status === "error" && "Something went wrong. Try again."}
      </div>
    </div>
  );
}
