import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import { useProjectStore } from "../stores/projectStore";
import {
  applyTaskSessionEvent,
  applyTaskStatusEvent,
  useLocalSessionStore,
  type LocalSession,
  type LocalSessionStatus,
} from "./localSessionStore";
import NewTaskView, { type NewTaskSubmit } from "./NewTaskView";
import type {
  LocalTerminalLaunch,
  LocalTerminalManager,
} from "./useTerminalManager";
import { useTerminalManager } from "./useTerminalManager";
import styles from "./LocalDevPanel.module.css";

interface RawTaskStatusEvent {
  task_id?: string;
  taskId?: string;
  status?: string;
}

interface RawTaskSessionEvent {
  task_id?: string;
  taskId?: string;
  agent?: "claude" | "codex";
  session_id?: string;
  sessionId?: string;
  session_path?: string;
  sessionPath?: string;
  title?: string;
  modified_at?: number;
  modifiedAt?: number;
}

function eventTaskId(payload: {
  task_id?: string;
  taskId?: string;
}): string | null {
  return payload.task_id ?? payload.taskId ?? null;
}

function taskStatus(value: string | undefined): LocalSessionStatus | null {
  if (
    value === "history" ||
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function toLaunch(task: LocalSession): LocalTerminalLaunch {
  return {
    taskId: task.taskId,
    projectPath: task.projectPath,
    agent: task.agent,
    permissionMode: task.permissionMode,
    operation: task.operation,
    prompt: task.prompt,
    sessionId: task.sourceSessionId ?? task.sessionId,
    images: task.images,
    texts: task.texts,
  };
}

function promptWithReferences(input: NewTaskSubmit): string {
  const references =
    input.fileRefs.length > 0
      ? [
          "Referenced project files:",
          ...input.fileRefs.map((path) => "@" + path),
        ].join("\n")
      : "";
  return [input.prompt, references].filter(Boolean).join("\n\n");
}

let taskEventRegistration: Promise<void> | null = null;

function ensureTaskEventListeners(): Promise<void> {
  if (taskEventRegistration) return taskEventRegistration;
  taskEventRegistration = Promise.all([
    listen<RawTaskStatusEvent>("task-status", (event) => {
      const taskId = eventTaskId(event.payload);
      const status = taskStatus(event.payload.status);
      if (taskId && status) applyTaskStatusEvent({ taskId, status });
    }),
    listen<RawTaskSessionEvent>("task-session", (event) => {
      const payload = event.payload;
      const taskId = eventTaskId(payload);
      if (!taskId || !payload.agent) return;
      const sessionId = payload.session_id ?? payload.sessionId;
      if (!sessionId) return;
      applyTaskSessionEvent({
        taskId,
        agent: payload.agent,
        sessionId,
        sessionPath: payload.session_path ?? payload.sessionPath,
        title: payload.title,
        modifiedAt: payload.modified_at ?? payload.modifiedAt,
      });
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      taskEventRegistration = null;
      throw error;
    });
  return taskEventRegistration;
}

export default function LocalDevPanel() {
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const addProject = useProjectStore((state) => state.addProject);
  const allSessions = useLocalSessionStore((state) => state.sessions);
  const activeTaskId = useLocalSessionStore((state) => state.activeTaskId);
  const selectSession = useLocalSessionStore((state) => state.selectSession);
  const startTask = useLocalSessionStore((state) => state.startTask);
  const updateStatus = useLocalSessionStore((state) => state.updateStatus);
  const loadHistory = useLocalSessionStore((state) => state.loadHistory);
  const [showComposer, setShowComposer] = useState(true);
  const manager = useTerminalManager();
  const historyLoadId = useRef(0);

  const sessions = useMemo(
    () =>
      activeProjectPath
        ? allSessions.filter(
            (session) => session.projectPath === activeProjectPath,
          )
        : [],
    [activeProjectPath, allSessions],
  );
  const activeSession =
    sessions.find((session) => session.taskId === activeTaskId) ?? null;
  const launchedSessions = sessions.filter(
    (session) => session.status !== "history",
  );

  useEffect(() => {
    void ensureTaskEventListeners().catch((error) => {
      console.error("register local task events failed", error);
    });
  }, []);

  useEffect(() => {
    if (!activeProjectPath) return;
    const requestId = ++historyLoadId.current;
    void loadHistory(activeProjectPath).catch((error) => {
      if (requestId === historyLoadId.current) {
        console.error("load local session history failed", error);
      }
    });
  }, [activeProjectPath, loadHistory]);

  useEffect(() => {
    if (activeTaskId && activeSession) setShowComposer(false);
  }, [activeTaskId, activeSession]);

  useEffect(() => {
    setShowComposer(true);
    selectSession(null);
  }, [activeProjectPath, selectSession]);

  if (!activeProjectPath) {
    return (
      <EmptyState
        icon="bot"
        title="选择一个本地项目开始开发"
        hint="项目目录只保存在本机，用于启动 Claude Code 或 Codex"
        action={
          <button
            type="button"
            className="btn"
            onClick={() => void addProject()}
          >
            添加项目目录
          </button>
        }
      />
    );
  }

  const submitTask = (input: NewTaskSubmit) => {
    const task = startTask({
      projectPath: activeProjectPath,
      agent: input.agent,
      prompt: promptWithReferences(input),
      permissionMode: input.permissionMode,
      fileRefs: input.fileRefs,
      images: input.images,
      texts: input.texts,
    });
    selectSession(task.taskId);
    setShowComposer(false);
  };

  const startFromHistory = (
    session: LocalSession,
    operation: "resume" | "fork",
  ) => {
    if (!session.sessionId) return;
    const task = startTask({
      projectPath: activeProjectPath,
      agent: session.agent,
      prompt: session.title,
      permissionMode: "ask",
      operation,
      sourceSessionId: session.sessionId,
    });
    selectSession(task.taskId);
    setShowComposer(false);
  };

  return (
    <section className={styles.panel} aria-label="本地开发面板">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>LOCAL DEVELOPMENT</div>
          <h1>本地开发</h1>
        </div>
        <div className={styles.headerActions}>
          <code title={activeProjectPath}>{activeProjectPath}</code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              selectSession(null);
              setShowComposer(true);
            }}
          >
            <Icon name="newChat" size={14} /> 新建任务
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {showComposer ? (
          <div className={styles.composer}>
            <NewTaskView
              projectPath={activeProjectPath}
              onSubmit={submitTask}
            />
          </div>
        ) : activeSession?.status === "history" ? (
          <HistorySessionView
            session={activeSession}
            onResume={() => startFromHistory(activeSession, "resume")}
            onFork={() => startFromHistory(activeSession, "fork")}
          />
        ) : activeSession ? (
          <TerminalSurface
            sessions={launchedSessions}
            activeTaskId={activeSession.taskId}
            manager={manager}
            onCancel={async () => {
              await manager.cancel(activeSession.taskId, activeProjectPath);
              updateStatus({
                taskId: activeSession.taskId,
                status: "cancelled",
              });
            }}
          />
        ) : (
          <EmptyState
            icon="terminal"
            title="选择或创建一个本地会话"
            hint="从左侧会话列表恢复历史，或者点击右上角新建任务"
          />
        )}
      </div>
    </section>
  );
}

function HistorySessionView({
  session,
  onResume,
  onFork,
}: {
  session: LocalSession;
  onResume: () => void;
  onFork: () => void;
}) {
  return (
    <div className={styles.history}>
      <Icon name="refresh" size={28} />
      <div className={styles.historyAgent}>
        {session.agent.toUpperCase()} SESSION
      </div>
      <h2>{session.title}</h2>
      <p>这是从本地 JSONL 发现的历史会话。可以继续原会话，或创建一个分支。</p>
      <div className={styles.historyActions}>
        <button type="button" className="btn" onClick={onResume}>
          <Icon name="play" size={14} /> Resume
        </button>
        <button type="button" className="btn btn-secondary" onClick={onFork}>
          Fork session
        </button>
      </div>
    </div>
  );
}

function TerminalSurface({
  sessions,
  activeTaskId,
  manager,
  onCancel,
}: {
  sessions: LocalSession[];
  activeTaskId: string;
  manager: LocalTerminalManager;
  onCancel: () => Promise<void>;
}) {
  const active = sessions.find((session) => session.taskId === activeTaskId);
  if (!active) return null;

  return (
    <div className={styles.terminalSurface}>
      <div className={styles.terminalToolbar}>
        <div className={styles.terminalTitle}>
          <span className={styles.statusDot} data-status={active.status} />
          <strong>{active.title}</strong>
          <span>{active.agent}</span>
        </div>
        <div className={styles.terminalActions}>
          {active.status === "running" && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void onCancel()}
            >
              <Icon name="stop" size={13} /> 停止
            </button>
          )}
          <span className={styles.statusLabel}>
            {statusLabel(active.status)}
          </span>
        </div>
      </div>
      <div className={styles.stack}>
        {sessions.map((session) => (
          <LocalTerminalHost
            key={session.taskId}
            task={session}
            manager={manager}
            visible={session.taskId === activeTaskId}
          />
        ))}
      </div>
    </div>
  );
}

function LocalTerminalHost({
  task,
  manager,
  visible,
}: {
  task: LocalSession;
  manager: LocalTerminalManager;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    if (manager.has(task.taskId)) {
      manager.attach(task.taskId, hostRef.current);
      return;
    }
    void manager.open(toLaunch(task), hostRef.current).catch(() => {
      useLocalSessionStore
        .getState()
        .updateStatus({ taskId: task.taskId, status: "failed" });
    });
  }, [manager, task, task.taskId]);

  useEffect(() => {
    if (!visible) return;
    manager.fit(task.taskId);
    manager.focus(task.taskId);
  }, [manager, task.taskId, visible]);

  return (
    <div
      ref={hostRef}
      className={styles.host}
      style={{ visibility: visible ? "visible" : "hidden" }}
      aria-hidden={!visible}
    />
  );
}

function statusLabel(status: LocalSessionStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "failed":
      return "启动失败";
    case "cancelled":
      return "已停止";
    default:
      return "历史";
  }
}
