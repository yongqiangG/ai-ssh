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
  const cmdHistory = useChatStore((s) => s.cmdHistory);
  const thinkingEnabled = useChatStore((s) => s.thinkingEnabled);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 方案2：历史命令导航。historyIndex=null 表示不在导航（显示当前输入/草稿）。
  // cmdHistory 最新在末尾，故 null→length-1 是「最新一条」，index 减=更旧。
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef<string>("");

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
    setHistoryIndex(null);
    draftRef.current = "";
    void sendMessage(text);
  };

  // 光标是否在第一行（前面无换行）/ 最后行（后面无换行）——多行内容时只在首/末行触发历史导航
  const isFirstLine = (el: HTMLTextAreaElement) =>
    el.value.substring(0, el.selectionStart).indexOf("\n") === -1;
  const isLastLine = (el: HTMLTextAreaElement) =>
    el.value.substring(el.selectionStart).indexOf("\n") === -1;

  const goPrevHistory = () => {
    if (cmdHistory.length === 0) return;
    if (historyIndex === null) draftRef.current = value; // 进入历史前存草稿
    const next = historyIndex === null ? cmdHistory.length - 1 : Math.max(0, historyIndex - 1);
    setHistoryIndex(next);
    setValue(cmdHistory[next]);
  };
  const goNextHistory = () => {
    if (historyIndex === null) return;
    const next = historyIndex + 1;
    if (next >= cmdHistory.length) {
      setHistoryIndex(null);
      setValue(draftRef.current); // 超过最新 → 恢复草稿（不循环）
    } else {
      setHistoryIndex(next);
      setValue(cmdHistory[next]);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    const el = taRef.current;
    if (e.key === "ArrowUp" && el && isFirstLine(el)) {
      e.preventDefault();
      goPrevHistory();
    } else if (e.key === "ArrowDown" && el && isLastLine(el)) {
      e.preventDefault();
      goNextHistory();
    }
    // 其它（多行中间的上/下、左右箭头）走默认光标移动
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
          className={`${styles.newBtn} ${thinkingEnabled ? styles.thinkingOn : ""}`}
          type="button"
          onClick={toggleThinking}
          title="深度思考：仅对下一条消息生效（响应更慢、分析更深入，适合复杂问题；发送后自动关闭）"
        >
          <Icon name="bot" size={14} />
          深度思考{thinkingEnabled ? "·开" : ""}
        </button>

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
          onChange={(e) => {
            setValue(e.target.value);
            // 用户手动编辑 → 退出历史导航（下次上箭头重新从最新开始）
            if (historyIndex !== null) setHistoryIndex(null);
          }}
          onKeyDown={onKeyDown}
          onInput={resize}
          placeholder={
            sending
              ? "AI 正在回复…"
              : "输入消息，Enter 发送 / Shift+Enter 换行 / ↑↓ 历史命令"
          }
          disabled={sending}
        />
        {sending ? (
          <button
            className={styles.sendBtn}
            type="button"
            onClick={() => useChatStore.getState().stop()}
            title="停止生成"
          >
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            type="button"
            onClick={send}
            disabled={!value.trim()}
            title="发送"
          >
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
