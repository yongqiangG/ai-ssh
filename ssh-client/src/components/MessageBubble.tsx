import { useEffect, useRef, useState } from "react";
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
  const [quoteOpen, setQuoteOpen] = useState(false);

  useEffect(() => {
    onContentGrow?.();
  }, [message.content, message.reasoning, onContentGrow]);

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.aiRow}`}>
      <div className={styles.avatar}>
        <Icon name={isUser ? "chat" : "bot"} size={16} />
      </div>
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        <div className={styles.content}>
          {isUser && message.quote && (
            <div
              className={styles.quoteBlock}
              onClick={() => setQuoteOpen((v) => !v)}
              title={quoteOpen ? "收起引用" : "展开引用"}
            >
              <span className={styles.quoteHead}>
                <Icon name="terminal" size={11} /> 引用终端输出
                <span className={styles.quoteToggle}>{quoteOpen ? "▾" : "▸"}</span>
              </span>
              {quoteOpen && <pre className={styles.quoteBody}>{message.quote}</pre>}
            </div>
          )}
          {!isUser && message.reasoning && (
            <ThinkingBlock
              reasoning={message.reasoning}
              live={typing && !message.content}
            />
          )}
          {!isUser &&
            message.toolCalls?.map((tc) => (
              <CommandBlock key={tc.toolCallId} call={tc} />
            ))}
          {isUser ? message.content : <MarkdownContent content={message.content} />}
          {typing && <span className={styles.caret} />}
          {isUser && message.contextLines != null && (
            <span className={styles.contextTag}>
              <Icon name="terminal" size={10} /> 已附终端上下文 · {message.contextLines} 行
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 深度思考块（260723 决议 9）：思维链流式期间（live）自动展开实时滚动——
 * 填补深思首 token 慢的等待空窗；正文到达后 live 变 false 自动折叠为一行，
 * 点击可随时展开回看（历史消息默认折叠）。用户手动切换后不再被自动开合干预。
 */
function ThinkingBlock({ reasoning, live }: { reasoning: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const userToggledRef = useRef(false);
  const bodyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!userToggledRef.current) setOpen(live);
  }, [live]);

  // 流式期间新片段到达时保持滚动在思维链末尾
  useEffect(() => {
    if (open && live && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [reasoning, open, live]);

  return (
    <div className={`${styles.thinkingBlock} ${live ? styles.thinkingLive : ""}`}>
      <span
        className={styles.thinkingHead}
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
        title={open ? "收起思考过程" : "展开思考过程"}
      >
        <Icon name="bot" size={11} />
        {live ? "深度思考中…" : "已深度思考"}
        <span className={styles.thinkingToggle}>{open ? "▾" : "▸"}</span>
      </span>
      {open && (
        <pre ref={bodyRef} className={styles.thinkingBody}>
          {reasoning}
        </pre>
      )}
    </div>
  );
}
