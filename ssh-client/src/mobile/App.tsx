import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiGet,
  checkHealth,
  getToken,
  setToken,
  type Project,
  type Task,
} from "./api";
import { TaskView } from "./TaskView";
import { NewTaskView } from "./NewTaskView";

type View =
  | { kind: "setup"; error?: string }
  | { kind: "projects" }
  | { kind: "tasks"; project: Project }
  | { kind: "task"; task: Task; project: Project }
  | { kind: "newTask"; project: Project };

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  running: { text: "运行中", cls: "st-running" },
  input_required: { text: "待确认", cls: "st-attention" },
  awaiting_review: { text: "待验收", cls: "st-attention" },
  done: { text: "完成", cls: "st-done" },
  failed: { text: "失败", cls: "st-failed" },
  cancelled: { text: "已取消", cls: "st-muted" },
};

function statusBadge(status: string) {
  return STATUS_LABEL[status] ?? { text: status, cls: "st-muted" };
}

function fmtTime(ms: number): string {
  // Task.createdAt 为毫秒（桌面端 Date.now() 生成）
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function App() {
  const [view, setView] = useState<View>(() =>
    getToken() ? { kind: "projects" } : { kind: "setup" },
  );
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  // 阶段 1 为静态快照（进入页面拉一次）；阶段 2 起经 WS 事件流实时化
  const loadProjects = useCallback(async () => {
    try {
      setProjects(await apiGet<Project[]>("/api/projects"));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "0401") {
        setView({ kind: "setup", error: "令牌无效，请重新输入" });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setProjects(null);
    }
  }, []);

  const loadTasks = useCallback(async (project: Project) => {
    try {
      setTasks(await apiGet<Task[]>(`/api/projects/${project.id}/tasks`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTasks(null);
    }
  }, []);

  useEffect(() => {
    if (view.kind === "projects") void loadProjects();
    if (view.kind === "tasks") void loadTasks(view.project);
  }, [view, loadProjects, loadTasks]);

  useEffect(() => {
    void checkHealth().then(setReachable);
  }, []);

  // ── URL hash 路由（刷新/误退恢复位置）──
  // 读必须先于写：挂载时先捕获并恢复 hash，写 effect 的首次执行（初始视图
  // = 项目列表 → 清 hash）才不会把待恢复的输入擦掉。声明顺序即执行顺序。
  useEffect(() => {
    const hash = location.hash;
    if (!getToken() || !hash) return;
    const restore = async () => {
      if (hash.startsWith("#t-")) {
        const taskId = hash.slice(3);
        try {
          const task = await apiGet<Task>(`/api/tasks/${encodeURIComponent(taskId)}`);
          const list = await apiGet<Project[]>("/api/projects");
          const project = list.find((p) => p.id === task.projectId);
          if (project) {
            setProjects(list);
            setView({ kind: "task", task, project });
          }
        } catch {
          /* 任务已删/离线：留在项目列表 */
        }
      } else if (hash.startsWith("#p-")) {
        const projectId = hash.slice(3);
        try {
          const list = await apiGet<Project[]>("/api/projects");
          const project = list.find((p) => p.id === projectId);
          if (project) {
            setProjects(list);
            setView({ kind: "tasks", project });
          }
        } catch {
          /* 降级项目列表 */
        }
      }
    };
    void restore();
    // 仅挂载时恢复一次
  }, []);

  // 写：视图变化同步 #p-<projectId> / #t-<taskId>
  useEffect(() => {
    const hash =
      view.kind === "tasks"
        ? `#p-${view.project.id}`
        : view.kind === "task"
          ? `#t-${view.task.id}`
          : "";
    if (location.hash !== hash) {
      history.replaceState(null, "", hash || location.pathname);
    }
  }, [view]);

  if (view.kind === "setup") {
    return (
      <SetupView
        initialError={view.error}
        onDone={() => setView({ kind: "projects" })}
      />
    );
  }

  if (view.kind === "task") {
    return (
      <TaskView
        task={view.task}
        onBack={() => setView({ kind: "tasks", project: view.project })}
      />
    );
  }

  if (view.kind === "newTask") {
    return (
      <NewTaskView
        project={view.project}
        onStarted={(task) => setView({ kind: "task", task, project: view.project })}
        onCancel={() => setView({ kind: "tasks", project: view.project })}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        {view.kind === "tasks" ? (
          <button className="back" onClick={() => setView({ kind: "projects" })}>
            ‹ 返回
          </button>
        ) : (
          <span className="title">AI Coding</span>
        )}
        {view.kind === "tasks" && <span className="title">{view.project.name}</span>}
        {view.kind === "tasks" && (
          <button className="new-task-btn" onClick={() => setView({ kind: "newTask", project: view.project })}>
            + 新建
          </button>
        )}
        {reachable === false && <span className="health-offline">离线</span>}
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      {view.kind === "projects" &&
        (projects === null ? (
          <Loading text="加载项目…" />
        ) : projects.length === 0 ? (
          <Empty text="还没有项目（在桌面端添加）" />
        ) : (
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="card" onClick={() => setView({ kind: "tasks", project: p })}>
                  <span className="card-title">{p.name}</span>
                  <span className="card-sub">{p.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {view.kind === "tasks" &&
        (tasks === null ? (
          <Loading text="加载任务…" />
        ) : tasks.length === 0 ? (
          <Empty text="该项目还没有任务" />
        ) : (
          <ul className="list">
            {tasks.map((t) => {
              const badge = statusBadge(t.status);
              return (
                <li key={t.id}>
                  <button
                    className="card card-task"
                    onClick={() => setView({ kind: "task", task: t, project: view.project })}
                  >
                    <div className="task-head">
                      <span className={`status ${badge.cls}`}>{badge.text}</span>
                      <span className="task-time">{fmtTime(t.createdAt)}</span>
                    </div>
                    <span className="card-title">{t.name ?? t.prompt.slice(0, 60)}</span>
                    <span className="card-sub">
                      {t.agent} · {t.permissionMode}
                    </span>
                    {t.failureReason && <span className="task-fail">{t.failureReason}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

function SetupView({ initialError, onDone }: { initialError?: string; onDone: () => void }) {
  const [token, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setToken(token.trim());
      await apiGet<Project[]>("/api/projects");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <h1>ai-ssh 伴侣</h1>
      <p className="setup-hint">
        输入本机 <code>~/.ai-ssh/coding/web.json</code> 中的 <code>token</code>
      </p>
      <input
        className="token-input"
        type="text"
        value={token}
        placeholder="companion token"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setTokenInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && token.trim() && !busy) void submit();
        }}
      />
      {error && <div className="banner banner-error">{error}</div>}
      <button className="primary" disabled={!token.trim() || busy} onClick={() => void submit()}>
        {busy ? "验证中…" : "连接"}
      </button>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return <div className="state">{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="state">{text}</div>;
}
