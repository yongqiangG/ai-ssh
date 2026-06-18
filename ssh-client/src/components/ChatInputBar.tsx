import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Icon from "./Icon";
import { useChatStore } from "../stores/chatStore";
import styles from "./ChatInputBar.module.css";

export default function ChatInputBar() {
  const agents = useChatStore((s) => s.agents);
  const agentId = useChatStore((s) => s.agentId);
  const setAgent = useChatStore((s) => s.setAgent);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const newConversation = useChatStore((s) => s.newConversation);
  const sending = useChatStore((s) => s.sending);

  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // textarea 自适应高度
  const resize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(resize, [value]);

  const send = () => {
    const text = value.trim();
    if (!text || sending) return;
    setValue("");
    void sendMessage(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={styles.bar}>
      <div className={styles.toolbar}>
        <label className={styles.agentSelect}>
          <Icon name="bot" size={14} className={styles.agentIcon} />
          <select
            className={styles.select}
            value={agentId}
            onChange={(e) => setAgent(e.target.value)}
            title="选择智能体"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} className={styles.chevron} />
        </label>

        <button
          className={styles.newBtn}
          type="button"
          onClick={newConversation}
          title="新建对话"
        >
          <Icon name="newChat" size={14} />
          新建对话
        </button>
      </div>

      <div className={styles.inputRow}>
        <textarea
          ref={taRef}
          className={styles.textarea}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onInput={resize}
          placeholder={sending ? "AI 正在回复…" : "输入消息，Enter 发送 / Shift+Enter 换行"}
          disabled={sending}
        />
        <button
          className={styles.sendBtn}
          type="button"
          onClick={send}
          disabled={!value.trim() || sending}
          title="发送"
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}
