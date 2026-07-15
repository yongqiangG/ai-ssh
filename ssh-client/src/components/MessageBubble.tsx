import { useEffect } from "react";
import type { ChatMessage } from "../types";
import CommandBlock from "./CommandBlock";
import Icon from "./Icon";
import MarkdownContent from "./MarkdownContent";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: ChatMessage;
  /** 仅当前正在流式返回的 AI 消息为 true，用于显示末尾光标。 */
  animate?: boolean;
  /** 内容增长时回调，供外层保持滚动到底部。 */
  onContentGrow?: () => void;
}

export default function MessageBubble({
  message,
  animate = false,
  onContentGrow,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const typing = !isUser && animate;

  useEffect(() => {
    onContentGrow?.();
  }, [message.content, onContentGrow]);

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.aiRow}`}>
      <div className={styles.avatar}>
        <Icon name={isUser ? "chat" : "bot"} size={16} />
      </div>
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        <div className={styles.content}>
          {!isUser &&
            message.toolCalls?.map((tc) => (
              <CommandBlock key={tc.toolCallId} call={tc} />
            ))}
          {isUser ? message.content : <MarkdownContent content={message.content} />}
          {typing && <span className={styles.caret} />}
        </div>
      </div>
    </div>
  );
}
