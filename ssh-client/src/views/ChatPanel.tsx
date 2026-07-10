import { useCallback, useEffect, useRef } from "react";
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
  const freshId = useChatStore((s) => s.freshId);
  const loadAgents = useChatStore((s) => s.loadAgents);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const allMessages = current?.messages ?? [];
  const endRef = useRef<HTMLDivElement>(null);

  // 启动时从后端拉取智能体列表
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // 稳定引用：保持滚动到底
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // sending 中尾部「空 assistant 占位消息」（content 还没被流式填充）不单独渲染气泡，
  // 改用 typing 动画代替——避免占位气泡与 typing 行各显示一个头像（双头像问题）。
  // 一旦流式填入 content，占位消息正常显示，typing 隐藏。全程单头像。
  const visibleMessages = allMessages.slice();
  if (sending && visibleMessages.length > 0) {
    const last = visibleMessages[visibleMessages.length - 1];
    if (last.role === "assistant" && !last.content) visibleMessages.pop();
  }
  // typing 仅在「等待 AI 首字」时显示：sending 且最后可见消息是 user（尚无 assistant 回复）
  const lastVisible = visibleMessages[visibleMessages.length - 1];
  const showTyping = sending && (!lastVisible || lastVisible.role === "user");

  // 流式时同一条 assistant 消息 content 增长，借此触发滚动
  const lastContent =
    visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].content : "";
  useEffect(() => {
    scrollToEnd();
  }, [visibleMessages.length, sending, lastContent, scrollToEnd]);

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
        {allMessages.length === 0 ? (
          <EmptyState
            icon="bot"
            title="开始新对话"
            hint="在下方选择智能体并发送消息，AI 回复会流式显示"
          />
        ) : (
          <div className={styles.messageList}>
            {visibleMessages.map((m) => (
              // 仅对「本会话刚到达的 AI 回复」播放打字动画（freshId）；历史消息直接全量显示。
              // 流式 content 增长时，useTypewriter 会从当前可见长度继续逐字追赶，呈现打字机效果。
              <MessageBubble key={m.id} message={m} animate={m.id === freshId} onContentGrow={scrollToEnd} />
            ))}
            {showTyping && (
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
