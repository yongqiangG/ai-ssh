import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import MessageBubble from "../components/MessageBubble";
import ChatInputBar from "../components/ChatInputBar";
import LlmSettingsModal from "../components/LlmSettingsModal";
import Mascot from "../components/Mascot";
import { useChatStore } from "../stores/chatStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import { getTerminalSessionId } from "../terminal/terminalManager";
import { getLlmConfig } from "../api/llmConfig";
import styles from "./ChatPanel.module.css";

export default function ChatPanel() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const currentId = useChatStore((s) => s.currentId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const sending = useChatStore((s) => s.sending);
  const freshId = useChatStore((s) => s.freshId);
  const agents = useChatStore((s) => s.agents);
  const agentsError = useChatStore((s) => s.agentsError);
  const loadAgents = useChatStore((s) => s.loadAgents);
  const sessionNotice = useChatStore((s) => s.sessionNotice);
  const clearSessionNotice = useChatStore((s) => s.clearSessionNotice);
  const newConversation = useChatStore((s) => s.newConversation);

  // agents 为空时区分「未配置模型」与「加载失败」：查一次 llm-config
  // （启动门保证挂载即后端就绪，无需再看 readyStatus）
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    if (agents.length > 0) return;
    let cancelled = false;
    getLlmConfig()
      .then((c) => {
        if (!cancelled) setApiKeyConfigured(Boolean(c.apiKeyConfigured));
      })
      .catch(() => {
        if (!cancelled) setApiKeyConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agents.length]);

  // 终端绑定判定：与 chatStore.sendMessage 的取值逻辑同源
  // （activeId → getTerminalSessionId），避免「警示条没显示但实际没绑定」的不一致。
  // 订阅 tabs 保证终端 tab 状态变化（断开/关闭）时本组件重渲染、重新求值。
  const terminalActiveId = useTerminalStore((s) => s.activeId);
  useTerminalStore((s) => s.tabs);
  const terminalBound = Boolean(
    terminalActiveId && getTerminalSessionId(terminalActiveId),
  );
  const setActiveSidebarView = useLayoutStore((s) => s.setActiveSidebarView);
  const setShowSidebar = useLayoutStore((s) => s.setShowSidebar);
  const setShowTerminal = useLayoutStore((s) => s.setShowTerminal);
  const setCenterView = useLayoutStore((s) => s.setCenterView);
  const pulseAttention = useLayoutStore((s) => s.pulseAttention);
  const gotoConnections = useCallback(() => {
    setShowSidebar(true);
    setShowTerminal(true);
    setCenterView("terminal");
    setActiveSidebarView("servers");
    // 各面板本就展开时上面四个写入全幂等，脉冲是唯一可见反馈
    pulseAttention("servers");
  }, [setActiveSidebarView, setCenterView, setShowSidebar, setShowTerminal, pulseAttention]);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const isHistoryConversation = current?.contextStatus === "history";
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

  // 流式时同一条 assistant 消息 content 增长，借此触发滚动；
  // errorText 后到（错误条追加高度）也要触发，否则错误条可能露一半在视野外
  const lastContent =
    visibleMessages.length > 0
      ? visibleMessages[visibleMessages.length - 1].content
      : "";
  const lastErrorText =
    visibleMessages.length > 0
      ? visibleMessages[visibleMessages.length - 1].errorText
      : undefined;
  // 流式时仅在用户没上滚时自动到底（方案1：AI 回复时可上滚查看历史）
  useEffect(() => {
    if (!userScrolledUpRef.current) scrollToEnd();
  }, [visibleMessages.length, lastContent, lastErrorText, scrollToEnd]);

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
        <span className="panel-title">
          {current ? current.title : "AI 对话"}
        </span>
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
                  {c.title || "新对话"}{c.contextStatus === "history" ? "（历史）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="panel-body" ref={scrollRef} onScroll={onScroll}>
        {sessionNotice && (
          <div className={styles.sessionNotice}>
            <Mascot mood="thinking" size={40} />
            <div className={styles.sessionNoticeBody}>
              <div className={styles.sessionNoticeTitle}>{sessionNotice}</div>
              <div className={styles.sessionNoticeHint}>
                历史会话暂不支持继续对话，上下文恢复正在加速适配中。
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                clearSessionNotice();
                newConversation();
              }}
            >
              新建对话
            </button>
          </div>
        )}
        {agents.length === 0 && apiKeyConfigured === false ? (
          <EmptyState
            icon="bot"
            title="请先配置模型"
            hint="尚未配置 LLM API Key，配置后即可开始对话"
            action={
              <button className="btn" onClick={() => setSettingsOpen(true)}>
                打开模型设置
              </button>
            }
          />
        ) : agents.length === 0 ? (
          <EmptyState
            icon="bot"
            title="智能体加载失败"
            hint={agentsError ?? "未获取到可用智能体"}
            action={
              <button className="btn" onClick={() => void loadAgents()}>
                重试
              </button>
            }
          />
        ) : allMessages.length === 0 ? (
          <EmptyState
            icon="bot"
            title="开始新对话"
            hint="在下方选择智能体并发送消息，AI 回复会流式显示"
          />
        ) : (
          <div className={styles.messageList}>
            {visibleMessages.map((m) => (
              // 仅对正在流式返回的 AI 消息显示末尾光标；内容按服务端 chunk 即时渲染。
              <MessageBubble
                key={m.id}
                message={m}
                animate={sending && m.id === freshId}
                onContentGrow={onContentGrow}
              />
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

      {!terminalBound && (
        <button
          type="button"
          className={styles.terminalHint}
          onClick={gotoConnections}
          title="点击打开连接面板"
        >
          <Icon name="alert" size={14} className={styles.terminalHintIcon} />
          未连接终端，AI 无法执行命令——纯问答不受影响，点击此处连接服务器
        </button>
      )}
      {isHistoryConversation ? (
        <div className={styles.historyFooter}>
          <div className={styles.historyFooterBody}>
            <div className={styles.historyFooterTitle}>历史会话暂不支持继续对话</div>
            <div className={styles.historyFooterHint}>上下文恢复正在加速适配中</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={newConversation}>
            新建对话
          </button>
        </div>
      ) : (
        <ChatInputBar />
      )}
      <LlmSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </section>
  );
}
