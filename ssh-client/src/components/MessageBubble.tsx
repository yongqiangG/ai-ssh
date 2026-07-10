import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import Icon from "./Icon";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: ChatMessage;
  /** 仅本次会话内刚到达的 AI 回复为 true：播放流式打字动画 */
  animate?: boolean;
  /** 打字过程中内容增长时回调（供外层保持滚动到底） */
  onContentGrow?: () => void;
}

/**
 * 流式打字：enabled 时按 24ms/2字符 逐步显示 text。
 * - 尊重 prefers-reduced-motion：直接整段显示；
 * - enabled=false（历史消息）不启动定时器，直接全量。
 */
function useTypewriter(
  text: string,
  enabled: boolean,
  onGrow?: () => void
): number {
  const [visible, setVisible] = useState(() => (enabled ? 0 : text.length));
  // onGrow 存 ref：避免外层每次渲染的新函数触发 effect 重跑、打字重放
  const onGrowRef = useRef(onGrow);
  onGrowRef.current = onGrow;

  useEffect(() => {
    if (
      !enabled ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(text.length);
      return;
    }
    let i = 0;
    const timer = window.setInterval(() => {
      i = Math.min(text.length, i + 2);
      setVisible(i);
      onGrowRef.current?.();
      if (i >= text.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [enabled, text]);

  return visible;
}

export default function MessageBubble({
  message,
  animate = false,
  onContentGrow,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const visible = useTypewriter(message.content, animate && !isUser, onContentGrow);
  const typing = !isUser && visible < message.content.length;

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.aiRow}`}>
      <div className={styles.avatar}>
        <Icon name={isUser ? "chat" : "bot"} size={16} />
      </div>
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        <div className={styles.content}>
          {isUser ? message.content : message.content.slice(0, visible)}
          {typing && <span className={styles.caret} />}
        </div>
      </div>
    </div>
  );
}
