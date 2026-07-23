import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Icon from "./Icon";
import { useChatStore } from "../stores/chatStore";
import { LOOSE_ERROR_HINT } from "../utils/errorDetect";
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
  const quote = useChatStore((s) => s.quote);
  const setQuote = useChatStore((s) => s.setQuote);
  const attachContext = useChatStore((s) => s.attachContext);
  const toggleAttachContext = useChatStore((s) => s.toggleAttachContext);

  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 方案2：历史命令导航。historyIndex=null 表示不在导航（显示当前输入/草稿）。
  // cmdHistory 最新在末尾，故 null→length-1 是「最新一条」，index 减=更旧。
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef<string>("");

  // F1 Tab 补全的默认提问：引用内容像报错 → 分析；否则 → 解释（正则统一在 errorDetect）
  const defaultQuestion = quote
    ? LOOSE_ERROR_HINT.test(quote.text)
      ? "分析一下这个报错"
      : "解释一下这段输出"
    : null;

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
    // F1 渐进披露：有引用块且未输入时，Tab 填入默认提问（已输入时 Tab 保持原生焦点行为）
    if (e.key === "Tab" && defaultQuestion && !value.trim()) {
      e.preventDefault();
      setValue(defaultQuestion);
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
    <div className={styles.bar} id="chat-inputbar">
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
          title={
            thinkingEnabled
              ? "深度思考已开启：本会话持续生效（响应更慢、分析更深入）；点击关闭"
              : "深度思考：响应更慢、分析更深入，适合复杂问题；开启后持续生效，直到手动关闭"
          }
        >
          <Icon name="bot" size={14} />
          深度思考{thinkingEnabled ? "·开" : ""}
        </button>

        <button
          className={`${styles.newBtn} ${attachContext ? styles.thinkingOn : ""}`}
          type="button"
          onClick={toggleAttachContext}
          title={
            attachContext
              ? "已开启：每次发送自动附上当前终端最近 50 行输出（已脱敏），AI 能看到终端里发生了什么；点击关闭"
              : "开启后，每次发送自动附上当前终端最近 50 行输出（已脱敏），让 AI 看到终端里发生了什么"
          }
        >
          <Icon name="terminal" size={14} />
          让 AI 看终端{attachContext ? "·开" : ""}
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

      {quote && (
        <div className={styles.quoteBox}>
          <span className={styles.quoteIcon}>
            <Icon name="terminal" size={12} />
          </span>
          <pre className={styles.quoteText}>{quote.text}</pre>
          <button
            className={styles.quoteRemove}
            type="button"
            onClick={() => setQuote(null)}
            title="移除引用"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      <div className={styles.inputRow}>
        <textarea
          ref={taRef}
          id="chat-input"
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
              : defaultQuestion
                ? `按 Tab 快速提问：${defaultQuestion}`
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
