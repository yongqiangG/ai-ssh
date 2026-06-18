import { useEffect, useRef } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import MessageBubble from "../components/MessageBubble";
import ChatInputBar from "../components/ChatInputBar";
import { useChatStore } from "../stores/chatStore";
import styles from "./ChatPanel.module.css";

export default function ChatPanel() {
  const conversations = useChatStore((s) => s.conversations);
  const currentId = useChatStore((s) => s.currentId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const sending = useChatStore((s) => s.sending);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const messages = current?.messages ?? [];
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">{current ? current.title : "AI 对话"}</span>
        <div className="panel-actions">
          {conversations.length > 1 && (
            <select
              className={styles.convSelect}
              value={currentId ?? ""}
              onChange={(e) => selectConversation(e.target.value)}
              title="切换对话"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || "新对话"}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="panel-body">
        {messages.length === 0 ? (
          <EmptyState
            icon="bot"
            title="开始新对话"
            hint="在下方选择智能体并发送消息，AI 回复会显示在左侧"
          />
        ) : (
          <div className={styles.messageList}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {sending && (
              <div className={styles.typingRow}>
                <div className={styles.typingAvatar}>
                  <Icon name="bot" size={16} />
                </div>
                <div className={styles.typing}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <ChatInputBar />
    </section>
  );
}
