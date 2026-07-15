import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import MessageBubble from "../components/MessageBubble";
import ChatInputBar from "../components/ChatInputBar";
import LlmSettingsModal from "../components/LlmSettingsModal";
import { useChatStore } from "../stores/chatStore";
import styles from "./ChatPanel.module.css";

export default function ChatPanel() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const currentId = useChatStore((s) => s.currentId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const sending = useChatStore((s) => s.sending);
  const freshId = useChatStore((s) => s.freshId);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const allMessages = current?.messages ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 用户是否手动上滚离开底部（用 ref 同步，避免流式 effect 读到 state 异步旧值导致竞态）
  const userScrolledUpRef = useRef(false);

  // 稳定引用：保持滚动到底
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // 打字机每字符增长时的滚动回调（传给 MessageBubble）——仅在用户没上滚时滚，
  // 否则打字机高频 scrollToEnd 会把用户上滚拉回（方案1 关键修复点）。
  const onContentGrow = useCallback(() => {
    if (!userScrolledUpRef.current) scrollToEnd();
  }, [scrollToEnd]);

  // 50px 阈值：距底部 50px 内视为「在底部」。用户上滚离开底部 → userScrolledUpRef=true，暂停 auto-scroll。
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    userScrolledUpRef.current = !atBottom;
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
  // 流式时仅在用户没上滚时自动到底（方案1：AI 回复时可上滚查看历史）
  useEffect(() => {
    if (!userScrolledUpRef.current) scrollToEnd();
  }, [visibleMessages.length, lastContent, scrollToEnd]);

  // 切换会话 → 强制回底（看新会话最新消息）
  useEffect(() => {
    userScrolledUpRef.current = false;
    scrollToEnd();
  }, [currentId, scrollToEnd]);

  // 用户发新消息（sending 上升沿）→ 强制回底（看新回复）
  const prevSending = useRef(false);
  useEffect(() => {
    if (sending && !prevSending.current) {
      userScrolledUpRef.current = false;
      scrollToEnd();
    }
    prevSending.current = sending;
  }, [sending, scrollToEnd]);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">{current ? current.title : "AI 对话"}</span>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-btn"
            title="模型设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={16} />
          </button>
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

      <div className="panel-body" ref={scrollRef} onScroll={onScroll}>
        {allMessages.length === 0 ? (
          <EmptyState
            icon="bot"
            title="开始新对话"
            hint="在下方选择智能体并发送消息，AI 回复会流式显示"
          />
        ) : (
          <div className={styles.messageList}>
            {visibleMessages.map((m) => (
              // 仅对正在流式返回的 AI 消息显示末尾光标；内容按服务端 chunk 即时渲染。
              <MessageBubble key={m.id} message={m} animate={sending && m.id === freshId} onContentGrow={onContentGrow} />
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
      <LlmSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </section>
  );
}
