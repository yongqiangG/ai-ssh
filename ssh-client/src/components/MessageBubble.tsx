import type { ChatMessage } from "../types";
import Icon from "./Icon";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.aiRow}`}>
      <div className={styles.avatar}>
        <Icon name={isUser ? "chat" : "bot"} size={16} />
      </div>
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        <div className={styles.content}>{message.content}</div>
      </div>
    </div>
  );
}
