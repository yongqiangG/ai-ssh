import { useState } from "react";
import { apiPost, type Project, type Task } from "./api";

const AGENTS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

const PERMISSION_MODES = [
  { value: "ask", label: "Ask（每步确认）" },
  { value: "default", label: "Default" },
  { value: "full_access", label: "Full Access（免确认）" },
];

// 新建任务初始 PTY 尺寸——TaskView 连上后随 resize 帧纠正为手机实宽
const INITAL_COLS = 80;
const INITIAL_ROWS = 24;

export function NewTaskView({
  project,
  onStarted,
  onCancel,
}: {
  project: Project;
  onStarted: (task: Task) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState("claude");
  const [permissionMode, setPermissionMode] = useState("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await apiPost<Task>(`/api/projects/${project.id}/tasks`, {
        prompt: prompt.trim(),
        agent,
        permissionMode,
        cols: INITAL_COLS,
        rows: INITIAL_ROWS,
      });
      onStarted(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="new-task">
      <header className="topbar">
        <button className="back" onClick={onCancel}>
          ‹ 取消
        </button>
        <span className="title">新建任务 · {project.name}</span>
      </header>

      <div className="new-task-body">
        <label className="field-label">任务指令</label>
        <textarea
          className="prompt-input"
          value={prompt}
          placeholder="想让 agent 做什么…"
          rows={5}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <label className="field-label">Agent</label>
        <div className="seg">
          {AGENTS.map((a) => (
            <button
              key={a.value}
              className={`seg-btn ${agent === a.value ? "seg-on" : ""}`}
              onClick={() => setAgent(a.value)}
            >
              {a.label}
            </button>
          ))}
        </div>

        <label className="field-label">权限模式</label>
        <div className="seg seg-col">
          {PERMISSION_MODES.map((p) => (
            <button
              key={p.value}
              className={`seg-btn ${permissionMode === p.value ? "seg-on" : ""}`}
              onClick={() => setPermissionMode(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <button className="primary" disabled={!prompt.trim() || busy} onClick={() => void submit()}>
          {busy ? "启动中…" : "启动任务"}
        </button>
      </div>
    </div>
  );
}
