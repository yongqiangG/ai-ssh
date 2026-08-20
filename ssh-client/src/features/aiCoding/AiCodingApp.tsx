import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { open as openDialog, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Project,
  Task,
  TaskStatus,
  AgentType,
  PermissionMode,
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
} from "./types";
import {
  isActiveTaskStatus,
  DEFAULT_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
  DEFAULT_TERMINAL_SCROLLBACK,
  clampTerminalScrollback,
  DEFAULT_TASK_DISPLAY_WINDOW,
  normalizeTaskDisplayWindow,
} from "./types";
import { DEFAULT_UI_FONT, getDefaultMonoFont, isAutoDefaultMonoFont } from "./types";
import {
  consumePendingCodingNavigation,
  peekPendingCodingNavigation,
  subscribePendingCodingNavigation,
} from "./pendingNavigation";
import {
  isAttentionStatus,
  attentionTaskTitle,
  shouldShowAttentionBanner,
  useAttentionStore,
} from "./attention";
import { useLayoutStore } from "../../stores/layoutStore";
import type { FontFamily } from "./types";
import { quoteFontName } from "./utils/fonts";
import { WelcomePage } from "./components/WelcomePage";
import { ProjectPage } from "./components/ProjectPage";
import { KanbanView, OPEN_KANBAN_VIEW_EVENT } from "./components/KanbanView";
import { useToast } from "./components/Toast";
import { isToggleKanbanShortcut } from "./shortcuts";
import { APP_PLATFORM } from "./platform";
import { useTerminalManager } from "./hooks/useTerminalManager";
import { useI18n } from "./i18n";
import {
  normalizeProjectNameInput,
  validateProjectName,
  type ProjectRenameResult,
} from "./projectName";
import s from "./styles";
import "./App.css";

/** CSS 变量作用域挂载点（见 App.css / themes.css 的 .ai-coding-root）。 */
const THEME_VARIANT = "dark" as const;

function deriveProjectName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return path;

  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

async function persistProjects(
  projects: Project[],
  onError: (msg: string) => void,
  formatError: (error: string) => string,
): Promise<boolean> {
  try {
    await invoke("coding_save_projects", { projects });
    return true;
  } catch (e: unknown) {
    console.error(e);
    onError(formatError(String(e)));
    return false;
  }
}

// 启动时任务加载失败(文件损坏/IO 错误)的项目。本次会话内禁止对这些项目
// 覆盖写盘——此时内存 state 是空的,一旦写出去会把磁盘上尚可人工恢复的
// 数据覆盖或清空。重启后重新加载成功即自动解除。
const taskPersistBlockedProjectIds = new Set<string>();

function persistProjectTasks(
  projectId: string,
  allTasks: Task[],
  onError: (msg: string) => void,
  formatError: (error: string, projectId: string) => string,
) {
  if (taskPersistBlockedProjectIds.has(projectId)) {
    onError(
      formatError(
        "tasks failed to load at startup; saving is disabled to protect on-disk data (restart to retry)",
        projectId,
      ),
    );
    return;
  }
  invoke("coding_save_project_tasks", {
    projectId,
    tasks: allTasks.filter((t) => t.projectId === projectId),
  }).catch((e: unknown) => {
    console.error(e);
    onError(formatError(String(e), projectId));
  });
}

function persistProjectTasksQuietly(projectId: string, allTasks: Task[]) {
  if (taskPersistBlockedProjectIds.has(projectId)) return;
  invoke("coding_save_project_tasks", {
    projectId,
    tasks: allTasks.filter((t) => t.projectId === projectId),
  }).catch(console.error);
}

// 老用户首次升级到拖拽排序版本时,把 projects 数组按 id 升序排一次并落盘,
// 让上来看到的 rail 顺序和旧版本(railProjects useMemo 里的 sort)一致。
// 之后用户拖拽产生的顺序由 projects 数组本身承载,不再排序。
const RAIL_PROJECTS_ORDERED_KEY = "ai-ssh:aiCoding:rail-projects-ordered";

function isProjectsIdAscending(projects: Project[]): boolean {
  for (let i = 1; i < projects.length; i++) {
    if (Number(projects[i].id) < Number(projects[i - 1].id)) return false;
  }
  return true;
}

// 拖拽重排:beforeId === null 表示拖到 visible 末尾;draggedId === beforeId 视为无操作。
// visibleIds 是 rail 当前可见子集(过滤了 hiddenFromRail),src/dst 在这个子序列
// 里算 — 直接在完整 projects 上 splice 会因为 hidden 项夹在中间而无声改写它们的相对位置
// (用户取消隐藏时会看到位置错乱)。重排后只回填到 visible 槽位,hidden 项原位保留。
// 返回新数组(若顺序无变化则返回原数组,方便 setState 早退)。
function reorderProjects(
  projects: Project[],
  visibleIds: string[],
  draggedId: string,
  beforeId: string | null,
): Project[] {
  if (draggedId === beforeId) return projects;

  const srcIdxV = visibleIds.indexOf(draggedId);
  if (srcIdxV === -1) return projects;

  const dstIdxV = beforeId === null ? visibleIds.length : visibleIds.indexOf(beforeId);
  if (dstIdxV === -1) return projects;

  const newVisibleOrder = [...visibleIds];
  const [dragged] = newVisibleOrder.splice(srcIdxV, 1);
  const adjustedDstIdxV = dstIdxV > srcIdxV ? dstIdxV - 1 : dstIdxV;
  newVisibleOrder.splice(adjustedDstIdxV, 0, dragged);

  const visibleSet = new Set(visibleIds);
  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  let visibleCursor = 0;
  const next = projects.map((p) => {
    if (!visibleSet.has(p.id)) return p;
    const id = newVisibleOrder[visibleCursor++];
    return projectById.get(id) ?? p;
  });

  if (next.every((p, i) => p === projects[i])) return projects;
  return next;
}

interface ProjectViewState {
  selectedTaskId: string | null;
  isNewTask: boolean;
}

function createDefaultProjectViewState(): ProjectViewState {
  return { selectedTaskId: null, isNewTask: true };
}

function normalizeInterruptedTasksOnStartup(
  tasks: Task[],
  activeTaskIds: Set<string>,
): {
  tasks: Task[];
  changedProjectIds: Set<string>;
} {
  const interruptedAt = Date.now();
  const changedProjectIds = new Set<string>();
  const normalized = tasks.map((task) => {
    const hasLiveChild = activeTaskIds.has(task.id);
    if (!isActiveTaskStatus(task.status) && !(task.status === "interrupted" && hasLiveChild)) {
      return task;
    }

    if (hasLiveChild) {
      if (task.status === "detached") return task;
      changedProjectIds.add(task.projectId);
      return {
        ...task,
        status: "detached" as TaskStatus,
        updatedAt: interruptedAt,
        attentionRequestedAt: task.attentionRequestedAt ?? interruptedAt,
      };
    }

    if (task.status === "interrupted") return task;
    changedProjectIds.add(task.projectId);
    return {
      ...task,
      status: "interrupted" as TaskStatus,
      updatedAt: interruptedAt,
      attentionRequestedAt: task.attentionRequestedAt ?? interruptedAt,
    };
  });

  return { tasks: normalized, changedProjectIds };
}

function shouldIgnoreTaskStatusTransition(current: TaskStatus, next: TaskStatus): boolean {
  return (
    current === "detached" &&
    (next === "running" || next === "input_required" || next === "awaiting_review")
  );
}

function isLiveTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === "pending" ||
    status === "running" ||
    status === "input_required" ||
    status === "awaiting_review"
  );
}

function getInitialTerminalFontSize(): TerminalFontSize {
  const stored = localStorage.getItem("ai-ssh:aiCoding:terminalFontSize");
  if (stored == null) return DEFAULT_TERMINAL_FONT_SIZE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampTerminalFontSize(parsed) : DEFAULT_TERMINAL_FONT_SIZE;
}

function getInitialTaskDisplayWindow(): TaskDisplayWindow {
  const stored = localStorage.getItem("ai-ssh:aiCoding:taskDisplayWindow");
  return stored == null ? DEFAULT_TASK_DISPLAY_WINDOW : normalizeTaskDisplayWindow(stored);
}

function getInitialFontFamily(key: string, fallback: FontFamily): FontFamily {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  // 老版本 useEffect 无差别把当时的 DEFAULT_MONO_FONT 写进 localStorage,
  // 导致默认更新对老用户无效。识别到历史自动默认值就清掉,改用当前平台默认。
  if (key === "ai-ssh:aiCoding:monoFontFamily" && isAutoDefaultMonoFont(stored)) {
    localStorage.removeItem(key);
    return fallback;
  }
  // 旧版本写入的裸字体名（如 "Maple Mono NF CN"）在 Canvas 2D 下会被
  // tokenize 成多个 family 全部 miss；读出时统一 normalize 一次。
  return quoteFontName(stored);
}

function App() {
  const { showToast } = useToast();
  const { t } = useI18n();

  const rootRef = useRef<HTMLDivElement>(null);
  const [terminalFontSize, setTerminalFontSize] = useState<TerminalFontSize>(
    getInitialTerminalFontSize,
  );
  const [taskDisplayWindow, setTaskDisplayWindow] = useState<TaskDisplayWindow>(
    getInitialTaskDisplayWindow,
  );
  // 应用内提醒开关（260818 迁入 attention store）：横幅 + 双角标共用，
  // 持久化由 store 负责；此处仅为保持 children props 形状不变
  const attentionBadge = useAttentionStore((s) => s.attentionBadgeEnabled);
  const setAttentionBadge = useAttentionStore((s) => s.setAttentionBadgeEnabled);
  const [terminalScrollback, setTerminalScrollbackState] = useState<TerminalScrollback>(
    DEFAULT_TERMINAL_SCROLLBACK,
  );
  const handleTerminalScrollbackChange = useCallback((value: TerminalScrollback) => {
    const clamped = clampTerminalScrollback(value);
    setTerminalScrollbackState(clamped);
    invoke("coding_save_terminal_scrollback", { scrollback: clamped }).catch(console.error);
  }, []);
  const [uiFontFamily, setUiFontFamily] = useState<FontFamily>(() =>
    getInitialFontFamily("ai-ssh:aiCoding:uiFontFamily", DEFAULT_UI_FONT),
  );
  const [monoFontFamily, setMonoFontFamily] = useState<FontFamily>(() =>
    getInitialFontFamily("ai-ssh:aiCoding:monoFontFamily", getDefaultMonoFont()),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectViews, setProjectViews] = useState<Record<string, ProjectViewState>>({});
  const [mountedProjectIds, setMountedProjectIds] = useState<string[]>([]);
  const [taskRunCounts, setTaskRunCounts] = useState<Record<string, number>>({});
  const [showKanban, setShowKanban] = useState(false);

  // coding:task-status 监听只订阅一次（换依赖重订阅会在 unlisten promise 交接
  // 间隙丢事件），而应用内横幅判定需要读取最新 tasks/视图状态——ref 镜像 +
  // 每次提交后同步。读侧 getState()/ref 均为即时值，闭包不参与。
  const latestRef = useRef({ tasks, projects, activeProject, projectViews, showKanban });
  useEffect(() => {
    latestRef.current = { tasks, projects, activeProject, projectViews, showKanban };
  });

  // 待确认任务总数（与 project-rail attentionCount 同口径）→ ActivityBar 角标。
  // 事件到达 / 启动加载 / 删除任务统一走 tasks 派生，无需逐点维护。
  const pendingCount = useMemo(
    () => tasks.filter((t) => isAttentionStatus(t.status)).length,
    [tasks],
  );
  useEffect(() => {
    useAttentionStore.getState().setPendingCount(pendingCount);
  }, [pendingCount]);

  const tm = useTerminalManager();
  const pendingResumeStartsRef = useRef<Record<string, () => void>>({});

  const formatSaveProjectsError = useCallback(
    (error: string) => t("toast.saveProjectsFailed", { error }),
    [t],
  );
  const formatSaveTasksError = useCallback(
    (error: string, projectId: string) => t("toast.saveTasksFailed", { error, projectId }),
    [t],
  );

  const mountProject = useCallback((projectId: string) => {
    setMountedProjectIds((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
  }, []);

  const updateProjectView = useCallback((projectId: string, patch: Partial<ProjectViewState>) => {
    setProjectViews((prev) => ({
      ...prev,
      [projectId]: {
        ...createDefaultProjectViewState(),
        ...prev[projectId],
        ...patch,
      },
    }));
  }, []);

  const clearProjectView = useCallback((projectId: string) => {
    setProjectViews((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  function getProjectView(projectId: string): ProjectViewState {
    return projectViews[projectId] ?? createDefaultProjectViewState();
  }

  useEffect(() => {
    // 面板保活激活门（App.tsx display 切换而非卸载）：非激活时本组件仍挂载，
    // window 级监听若不设门会把快捷键泄漏到 SSH 视图（Alt+K 抢占）、看板
    // Portal（挂 body，display:none 管不到）会残留在 SSH 视图上。
    const panelActiveRef = { current: true };
    function handlePanelVisibility(event: Event) {
      const detail = (event as CustomEvent<{ active: boolean }>).detail;
      panelActiveRef.current = detail?.active !== false;
      if (!panelActiveRef.current) setShowKanban(false);
    }
    window.addEventListener("ai-ssh:aiCoding:panel-visibility", handlePanelVisibility);

    // Cmd+K (macOS) / Alt+K (其他平台) 切换看板浮层。全平台启用——平台差异由
    // isToggleKanbanShortcut 内部处理（非 mac 用 Alt 以避开终端 Ctrl+K / Ctrl+Shift+C）。
    // 捕获阶段拦截，先于 xterm 处理；浮层内的 Esc 关闭仍由 KanbanView 自己负责。
    function handleToggleKanban(event: KeyboardEvent) {
      if (!panelActiveRef.current) return;
      if (!isToggleKanbanShortcut(event, APP_PLATFORM)) return;
      event.preventDefault();
      setShowKanban((prev) => !prev);
    }
    window.addEventListener("keydown", handleToggleKanban, true);
    return () => {
      window.removeEventListener("ai-ssh:aiCoding:panel-visibility", handlePanelVisibility);
      window.removeEventListener("keydown", handleToggleKanban, true);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-ssh:aiCoding:terminalFontSize", String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    let cancelled = false;
    invoke<{ terminal_scrollback?: unknown }>("coding_load_app_settings")
      .then((settings) => {
        if (cancelled) return;
        setTerminalScrollbackState(clampTerminalScrollback(settings.terminal_scrollback));
      })
      .catch(() => {
        /* 默认 1000 已经在 state 初值,无需 fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-ssh:aiCoding:taskDisplayWindow", String(taskDisplayWindow));
  }, [taskDisplayWindow]);

  useEffect(() => {
    const value = uiFontFamily.trim() || DEFAULT_UI_FONT;
    localStorage.setItem("ai-ssh:aiCoding:uiFontFamily", value);
    rootRef.current?.style.setProperty("--font-ui", value);
  }, [uiFontFamily]);

  useEffect(() => {
    const trimmed = monoFontFamily.trim();
    const effective = trimmed || getDefaultMonoFont();
    // 用户没显式自定义时不写入 localStorage,避免把默认值固化、
    // 导致后续改默认对老用户失效（这正是历史 bug 的根因）。
    if (!trimmed || isAutoDefaultMonoFont(trimmed)) {
      localStorage.removeItem("ai-ssh:aiCoding:monoFontFamily");
    } else {
      localStorage.setItem("ai-ssh:aiCoding:monoFontFamily", trimmed);
    }
    rootRef.current?.style.setProperty("--font-mono", effective);
  }, [monoFontFamily]);

  useEffect(() => {
    async function init() {
      // Load projects from ~/.ai-ssh/coding/projects.json
      const loadedProjects = await invoke<Project[]>("coding_load_projects");

      // 仅在首次升级到拖拽版本时做一次性顺序迁移:若 projects.json 不是
      // id 升序(老版本 handleOpen 把新项目插到首位,所以多半是降序),
      // 重排成 id 升序并落盘,与旧版 railProjects 的视觉顺序保持一致。
      // 之后顺序由用户拖拽决定,不再触发此分支。
      const alreadyOrdered = localStorage.getItem(RAIL_PROJECTS_ORDERED_KEY) === "1";
      const projectsForState =
        alreadyOrdered || isProjectsIdAscending(loadedProjects)
          ? loadedProjects
          : [...loadedProjects].sort((a, b) => Number(a.id) - Number(b.id));
      if (!alreadyOrdered) {
        // flag 必须在写盘成功后才落:否则一次磁盘失败 → flag 已锁 → 下次启动跳过
        // 迁移 → 老用户 rail 顺序永久错乱。无需写盘的分支可直接 set。
        if (projectsForState !== loadedProjects) {
          invoke("coding_save_projects", { projects: projectsForState })
            .then(() => {
              localStorage.setItem(RAIL_PROJECTS_ORDERED_KEY, "1");
            })
            .catch((e: unknown) => {
              console.error(e);
              showToast(formatSaveProjectsError(String(e)));
            });
        } else {
          localStorage.setItem(RAIL_PROJECTS_ORDERED_KEY, "1");
        }
      }
      setProjects(projectsForState);

      // Load tasks for all known projects。allSettled 隔离单项目失败:
      // 一个 tasks.json 损坏不能让所有项目的任务在 UI 里消失(Promise.all
      // 整体 reject 曾造成这个假象),失败项目单独提示并禁止写盘。
      const results = await Promise.allSettled(
        loadedProjects.map((p) => invoke<Task[]>("coding_load_project_tasks", { projectId: p.id })),
      );
      const chunks: Task[][] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          chunks.push(result.value);
          return;
        }
        const project = loadedProjects[i];
        taskPersistBlockedProjectIds.add(project.id);
        console.error(result.reason);
        showToast(t("toast.loadTasksFailed", { name: project.name, error: String(result.reason) }));
      });
      const activeTaskIds = new Set(await invoke<string[]>("coding_get_active_task_ids"));
      const { tasks: loadedTasks, changedProjectIds } = normalizeInterruptedTasksOnStartup(
        chunks.flat(),
        activeTaskIds,
      );
      setTasks(loadedTasks);
      changedProjectIds.forEach((projectId) => {
        persistProjectTasksQuietly(projectId, loadedTasks);
      });
    }

    init().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 用 backend 列表作为内容权威,但顺序以 prev 为准:用户拖拽产生的顺序保存在
    // 前端 state 里,不能被一次后台 reload 还原。共有项的字段由 authoritative 覆盖;
    // prev 独有的(尚未持久化)条目保留;authoritative 独有的新增追加到末尾。
    const mergeProjects = (authoritative: Project[]) => {
      setProjects((prev) => {
        const authMap = new Map<string, Project>();
        authoritative.forEach((p) => authMap.set(p.id, p));
        const seenIds = new Set<string>();
        const next: Project[] = [];
        for (const p of prev) {
          const auth = authMap.get(p.id);
          if (auth !== undefined) {
            next.push(auth);
            seenIds.add(p.id);
          } else {
            next.push(p);
          }
        }
        for (const p of authoritative) {
          if (!seenIds.has(p.id)) next.push(p);
        }
        return next;
      });
    };

    invoke<Project[]>("coding_load_projects")
      .then((loadedProjects) => mergeProjects(loadedProjects))
      .catch(console.error);
  }, []);

  // Tauri event listeners (agent-output is handled inside useTerminalManager)
  useEffect(() => {
    const p1 = listen<{ task_id: string; status: TaskStatus; failure_reason?: string }>(
      "coding:task-status",
      (e) => {
        const { task_id, status, failure_reason } = e.payload;
        updateTaskStatus(task_id, status, undefined, failure_reason);
        // failed 保留终端缓冲（2026-08-17 决议 b）：RunningView 保留 PTY 末屏供
        // 定位死因；其余非 active 状态（done/cancelled）照旧清缓冲。app 重启后
        // 无内存缓冲，RunningView 自行回落 SessionView。
        if (!isActiveTaskStatus(status) && status !== "failed") {
          tm.removeTaskBuffers([task_id]);
        }
        maybePushAttentionBanner(task_id, status);
      },
    );
    const p2 = listen<{ task_id: string; session_id: string; session_path: string }>(
      "coding:task-session",
      (e) => {
        const { task_id, session_id, session_path } = e.payload;
        updateTaskSession(task_id, session_id, session_path);
      },
    );
    // 适配层安全侧回退告警（版本映射不命中，任务已按最保守行为启动）
    const p3 = listen<{ agent: string; permissionMode: string }>(
      "coding:compat-warning",
      (e) => {
        showToast(
          t("perm.compatWarning", {
            agent: e.payload.agent === "codex" ? "Codex" : "Claude",
            mode: e.payload.permissionMode,
          }),
          "warning",
        );
      },
    );
    return () => {
      p1.then((fn) => fn());
      p2.then((fn) => fn());
      p3.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpen() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;
    const path = selected as string;
    const existing = projects.find((p) => p.path === path);
    const project: Project = existing
      ? { ...existing, lastOpenedAt: Date.now() }
      : { id: `${Date.now()}`, name: deriveProjectName(path), path, lastOpenedAt: Date.now() };
    setProjects((prev) => {
      const next = existing ? prev.map((p) => (p.path === path ? project : p)) : [project, ...prev];
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, createDefaultProjectViewState());
    invoke("coding_init_project_config", { projectPath: path }).catch((e: unknown) => {
      showToast(t("toast.initProjectConfigFailed", { error: String(e) }), "warning");
    });
  }

  function handleProjectClick(project: Project) {
    const updated = { ...project, lastOpenedAt: Date.now() };
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === project.id ? updated : p));
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setActiveProject(updated);
    mountProject(updated.id);
    invoke("coding_init_project_config", { projectPath: project.path }).catch((e: unknown) => {
      showToast(t("toast.initProjectConfigFailed", { error: String(e) }), "warning");
    });
  }

  function handleBack() {
    setActiveProject(null);
  }

  function invokeRunTask(task: Task, projectPath: string, images: string[], texts: string[] = []) {
    invoke("coding_run_task", {
      taskId: task.id,
      projectPath,
      prompt: task.prompt,
      agent: task.agent,
      permissionMode: task.permissionMode,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      images,
      texts,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  async function handleSubmitTask(
    project: Project,
    {
      prompt,
      agent,
      permissionMode,
      model,
      reasoningEffort,
      images,
      texts,
      immediate,
    }: {
      prompt: string;
      agent: AgentType;
      permissionMode: PermissionMode;
      model?: string;
      reasoningEffort?: string;
      images: string[];
      texts: string[];
      immediate: boolean;
    },
  ) {
    const taskId = `${Date.now()}`;

    // 1) 立即把任务推到 state 让 view 切到 RunningView。
    const now = Date.now();
    const baseTask: Task = {
      id: taskId,
      projectId: project.id,
      prompt,
      name: prompt ? undefined : `task-${taskId}`,
      agent,
      permissionMode,
      model,
      reasoningEffort,
      status: immediate ? "pending" : "todo",
      createdAt: now,
      updatedAt: now,
    };
    setTasks((prev) => {
      const next = [baseTask, ...prev];
      persistProjectTasks(baseTask.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, { selectedTaskId: taskId, isNewTask: false });

    if (!immediate) return;

    // 2) 终端 buffer 在 PTY 启动前就要建好，否则首批输出会进不来 buffer。
    tm.resetTaskTerminal(taskId);

    // 3) Agent cwd 恒为 project.path（workspace 根）。
    invokeRunTask(baseTask, project.path, images, texts);
  }

  function handleRunTodoTask(task: Task) {
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: "pending" as TaskStatus,
              updatedAt: Date.now(),
              attentionRequestedAt: undefined,
            }
          : t,
      );
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    tm.resetTaskTerminal(task.id);
    updateProjectView(task.projectId, { selectedTaskId: task.id, isNewTask: false });
    invokeRunTask(task, project.path, []);
  }

  function handleCancelTask(taskId: string) {
    delete pendingResumeStartsRef.current[taskId];
    const task = tasks.find((t) => t.id === taskId);
    const project = projects.find((p) => p.id === task?.projectId);
    const projectPath = project?.path ?? "";
    invoke("coding_cancel_task", { taskId, projectPath }).catch((e: unknown) => {
      showToast(t("toast.cancelTaskFailed", { error: String(e) }));
    });
  }

  function invokeResumeTask(task: Task, project: Project, sessionId: string) {
    invoke("coding_resume_task", {
      taskId: task.id,
      projectPath: project.path,
      agent: task.agent,
      sessionId,
      prompt: task.prompt,
      permissionMode: task.permissionMode,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  function handleResumeTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    const sessionId = task?.agent === "codex" ? task.codexSessionId : task?.claudeSessionId;
    if (!task) return;
    if (!sessionId) {
      showToast(t("running.resumeUnavailable"), "warning");
      return;
    }
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    // Reset task status, clear buffer, and bump run counter to remount the terminal
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: "pending" as TaskStatus,
              updatedAt: Date.now(),
              attentionRequestedAt: undefined,
            }
          : t,
      );
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    tm.resetTaskTerminal(taskId);
    setTaskRunCounts((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));

    pendingResumeStartsRef.current[taskId] = () => {
      invokeResumeTask(task, project, sessionId);
    };
  }

  function invokeForkTask(task: Task, project: Project, sourceSessionId: string) {
    invoke("coding_fork_task", {
      taskId: task.id,
      projectPath: project.path,
      agent: task.agent,
      sourceSessionId,
      permissionMode: task.permissionMode,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  function handleForkTask(sourceTaskId: string, requestedName: string) {
    const sourceTask = tasks.find((task) => task.id === sourceTaskId);
    if (!sourceTask) return;

    const sourceSessionId =
      sourceTask.agent === "codex" ? sourceTask.codexSessionId : sourceTask.claudeSessionId;
    if (!sourceSessionId) {
      showToast(t("running.forkUnavailable"), "warning");
      return;
    }
    const name = requestedName.trim();
    if (!name) return;
    const project = projects.find((candidate) => candidate.id === sourceTask.projectId);
    if (!project) return;

    const now = Date.now();
    const forkedTask: Task = {
      id: `${now}`,
      projectId: sourceTask.projectId,
      name,
      prompt: "",
      agent: sourceTask.agent,
      permissionMode: sourceTask.permissionMode,
      model: sourceTask.model,
      reasoningEffort: sourceTask.reasoningEffort,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    setTasks((prev) => {
      const next = [forkedTask, ...prev];
      persistProjectTasks(forkedTask.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, { selectedTaskId: forkedTask.id, isNewTask: false });
    tm.resetTaskTerminal(forkedTask.id);
    invokeForkTask(forkedTask, project, sourceSessionId);
  }

  async function handleReconnectTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const sessionId = task.agent === "codex" ? task.codexSessionId : task.claudeSessionId;
    if (!sessionId) {
      showToast(t("running.resumeUnavailable"), "warning");
      return;
    }

    try {
      await invoke("coding_reset_task_process", { taskId });
    } catch (e: unknown) {
      showToast(t("toast.resetTaskFailed", { error: String(e) }));
      return;
    }
    handleResumeTask(taskId);
  }

  function handleMarkTaskDone(taskId: string) {
    delete pendingResumeStartsRef.current[taskId];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (isLiveTerminalTaskStatus(task.status)) {
      const project = projects.find((p) => p.id === task.projectId);
      const projectPath = project?.path ?? "";
      invoke("coding_complete_task", { taskId, projectPath })
        .then(() => {
          tm.removeTaskBuffers([taskId]);
        })
        .catch((e: unknown) => {
          showToast(t("toast.completeTaskFailed", { error: String(e) }));
        });
      return;
    }

    updateTaskStatus(taskId, "done");
    tm.removeTaskBuffers([taskId]);
  }

  function deleteTasks(taskIds: string[]) {
    if (taskIds.length === 0) return;

    setTasks((prev) => {
      const toDelete = new Set(taskIds);
      const deletingTasks = prev.filter((task) => toDelete.has(task.id));

      if (deletingTasks.length === 0) return prev;

      taskIds.forEach((taskId) => {
        delete pendingResumeStartsRef.current[taskId];
      });

      deletingTasks
        .filter((task) => isActiveTaskStatus(task.status))
        .forEach((task) => {
          const proj = projects.find((p) => p.id === task.projectId);
          const projectPath = proj?.path ?? "";
          invoke("coding_cancel_task", { taskId: task.id, projectPath }).catch((e: unknown) => {
            showToast(t("toast.cancelTaskFailed", { error: String(e) }));
          });
        });

      const next = prev.filter((task) => !toDelete.has(task.id));
      const affectedProjectIds = new Set(deletingTasks.map((t) => t.projectId));
      affectedProjectIds.forEach((pid) =>
        persistProjectTasks(pid, next, showToast, formatSaveTasksError),
      );
      return next;
    });

    tm.removeTaskBuffers(taskIds);
    setProjectViews((prev) => {
      const toDelete = new Set(taskIds);
      let changed = false;
      const next = { ...prev };

      for (const [projectId, view] of Object.entries(prev)) {
        if (view.selectedTaskId && toDelete.has(view.selectedTaskId)) {
          next[projectId] = { ...view, selectedTaskId: null, isNewTask: true };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }

  async function handleDeleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const promptPreview = `${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}`;
    const ok = await confirm(t("task.deletePrompt", { prompt: promptPreview }), {
      title: t("task.deleteTitle"),
      kind: "warning",
    });
    if (!ok) return;
    deleteTasks([taskId]);
  }

  async function handleDeleteAllTasks(project: Project) {
    const projectTaskIds = tasks
      .filter((task) => task.projectId === project.id)
      .map((task) => task.id);
    if (projectTaskIds.length === 0) return;
    const ok = await confirm(
      t("task.clearPrompt", { count: projectTaskIds.length, project: project.name }),
      {
        title: t("task.clearTitle"),
        kind: "warning",
      },
    );
    if (!ok) return;
    deleteTasks(projectTaskIds);
  }

  function handleToggleTaskStar(taskId: string) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      const next = prev.map((t) => (t.id === taskId ? { ...t, starred: !t.starred } : t));
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  function handleRenameTask(taskId: string, name: string) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      const next = prev.map((t) => (t.id === taskId ? { ...t, name: name || undefined } : t));
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  async function handleGenerateTaskName(taskId: string) {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;
    // 按 agent 选择对应字段，避免历史数据两个字段都有时取错
    const sessionPath =
      task.agent === "codex" ? (task.codexSessionPath ?? null) : (task.claudeSessionPath ?? null);
    // 点击瞬间的快照，用于 await 完成后的并发校验（防止用户期间 rerun/resume/手改名）
    const expectedPriorName = task.name ?? "";
    const expectedPrompt = task.prompt;
    const expectedStatus = task.status;
    const expectedSessionPath = sessionPath;
    try {
      const name = await invoke<string>("coding_generate_task_name", {
        projectPath: project.path,
        agent: task.agent,
        sessionPath,
        originalPrompt: task.prompt,
      });
      const trimmed = name.trim();
      if (!trimmed) return;

      // await 期间用户可能删除任务、改名、重跑、resume 进新 session → 在同一个
      // setTasks updater 内完成校验和写入，避免依赖 React 对 updater 的同步调度。
      setTasks((prev) => {
        const current = prev.find((x) => x.id === taskId);
        if (!current) return prev;
        if ((current.name ?? "") !== expectedPriorName) return prev;
        if (current.prompt !== expectedPrompt) return prev;
        if (current.status !== expectedStatus) return prev;
        const currentSessionPath =
          current.agent === "codex"
            ? (current.codexSessionPath ?? null)
            : (current.claudeSessionPath ?? null);
        if (currentSessionPath !== expectedSessionPath) return prev;

        const next = prev.map((x) => (x.id === taskId ? { ...x, name: trimmed || undefined } : x));
        persistProjectTasks(current.projectId, next, showToast, formatSaveTasksError);
        return next;
      });
    } catch (e) {
      showToast(t("task.generateNameFailed", { error: String(e) }), "error");
      throw e;
    }
  }

  function handleUpdateTodo(
    taskId: string,
    updates: { prompt: string; agent: AgentType; permissionMode: PermissionMode },
  ) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task || task.status !== "todo") return prev;
      const next = prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...updates,
              model: updates.agent === t.agent ? t.model : undefined,
              reasoningEffort: updates.agent === t.agent ? t.reasoningEffort : undefined,
            }
          : t,
      );
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  async function handleDeleteProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const ok = await confirm(t("task.deleteProjectPrompt", { project: project.name }), {
      title: t("task.deleteProjectTitle"),
      kind: "warning",
    });
    if (!ok) return;
    const projectTaskIds = tasks.filter((t) => t.projectId === projectId).map((t) => t.id);
    deleteTasks(projectTaskIds);
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== projectId);
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setMountedProjectIds((prev) => prev.filter((id) => id !== projectId));
    // 260820 评审 P2-5：同步删数据目录（tasks.json + corrupt 备份），否则
    // 索引已删、目录永久残留。失败只 toast——索引已移除，重试无入口，残留
    // 目录下次删除同 id 项目时会被再试一次（幂等）。
    invoke("coding_delete_project_data", { projectId }).catch((e: unknown) => {
      showToast(t("toast.deleteProjectDataFailed", { error: String(e) }), "warning");
    });
    clearProjectView(projectId);
    setActiveProject((prev) => {
      if (prev?.id === projectId) {
        return null;
      }
      return prev;
    });
  }

  function handleToggleProjectHidden(projectId: string) {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === projectId ? { ...p, hiddenFromRail: !p.hiddenFromRail } : p,
      );
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
  }

  async function handleRenameProject(
    projectId: string,
    rawName: string,
  ): Promise<ProjectRenameResult> {
    const normalizedName = normalizeProjectNameInput(rawName);
    const current = projects.find((project) => project.id === projectId);
    if (current?.name === normalizedName) return { ok: true, name: current.name };

    const result = validateProjectName(rawName, projects, projectId);
    if (!result.ok) return result;

    const next = projects.map((project) =>
      project.id === projectId ? { ...project, name: result.name } : project,
    );
    const saved = await persistProjects(next, showToast, formatSaveProjectsError);
    if (!saved) return { ok: false, error: "save_failed" };

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, name: result.name } : project,
      ),
    );

    return result;
  }

  // 拖拽结束时一次性提交新顺序;beforeId === null 表示拖到 visible 末尾。
  // visibleIds 来自 ProjectRail 内部过滤后的 railProjects(去 hiddenFromRail),
  // src/dst 必须在这个子集里算,否则会无声打乱隐藏项的相对位置。
  // 拖拽期间 ProjectRail 内部只用 transform 让位,不会调到这里,避免高频重渲染和写盘。
  const handleCommitProjectOrder = useCallback(
    (draggedId: string, beforeId: string | null, visibleIds: string[]) => {
      setProjects((prev) => {
        const next = reorderProjects(prev, visibleIds, draggedId, beforeId);
        if (next === prev) return prev;
        persistProjects(next, showToast, formatSaveProjectsError);
        return next;
      });
    },
    [showToast, formatSaveProjectsError],
  );

  // 应用内待确认横幅（260818 决议）：窗口聚焦 && 待确认任务当前不可见
  // （终端级粒度，判定纯函数见 attention.ts）时推送全局横幅。失焦场景由
  // Rust OS toast 负责（notify.rs 判定含 !is_focused），两路互斥。
  function maybePushAttentionBanner(taskId: string, status: TaskStatus) {
    if (!isAttentionStatus(status)) return;
    const { tasks, projects, activeProject, projectViews, showKanban } = latestRef.current;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const view = activeProject ? projectViews[activeProject.id] : undefined;
    if (
      !shouldShowAttentionBanner({
        status,
        taskId,
        enabled: useAttentionStore.getState().attentionBadgeEnabled,
        windowFocused: document.hasFocus(),
        panelActive: useLayoutStore.getState().centerView === "aiCoding",
        activeProjectId: activeProject?.id ?? null,
        selectedTaskId: view?.selectedTaskId ?? null,
        isNewTask: view?.isNewTask ?? true,
        kanbanOpen: showKanban,
      })
    ) {
      return;
    }
    useAttentionStore.getState().pushAttentionBanner({
      taskId,
      status,
      title: attentionTaskTitle(task),
      projectName: projects.find((p) => p.id === task.projectId)?.name ?? "",
      agentName: task.agent === "codex" ? "Codex" : "Claude",
    });
  }

  function updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    extra?: Pick<Task, "attentionRequestedAt">,
    failureReason?: string,
  ) {
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        if (task.id !== taskId) return task;
        if (shouldIgnoreTaskStatusTransition(task.status, status)) return task;

        const attentionRequestedAt =
          status === "input_required" || status === "awaiting_review"
            ? (extra?.attentionRequestedAt ?? Date.now())
            : undefined;

        if (task.status === status && task.attentionRequestedAt === attentionRequestedAt) {
          return task;
        }

        changed = true;
        const updated: Task = { ...task, status, attentionRequestedAt, updatedAt: Date.now() };
        if (status === "failed" && failureReason) updated.failureReason = failureReason;
        return updated;
      });

      if (changed) {
        const task = next.find((t) => t.id === taskId);
        if (task) persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      }
      return changed ? next : prev;
    });
  }

  function updateTaskSession(taskId: string, sessionId: string, sessionPath: string) {
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        if (task.id !== taskId) return task;
        if (task.agent === "claude") {
          if (task.claudeSessionId === sessionId && task.claudeSessionPath === sessionPath)
            return task;
          changed = true;
          return { ...task, claudeSessionId: sessionId, claudeSessionPath: sessionPath };
        } else {
          if (task.codexSessionId === sessionId && task.codexSessionPath === sessionPath)
            return task;
          changed = true;
          return { ...task, codexSessionId: sessionId, codexSessionPath: sessionPath };
        }
      });

      if (changed) {
        const task = next.find((t) => t.id === taskId);
        if (task) persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      }
      return changed ? next : prev;
    });
  }

  function handleTerminalReady(taskId: string, generation: number) {
    tm.handleTerminalReady(taskId, generation);
    const startResume = pendingResumeStartsRef.current[taskId];
    if (!startResume) return;
    delete pendingResumeStartsRef.current[taskId];
    startResume();
  }

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
    [projects],
  );
  // rail 顺序直接由 projects 数组承载;拖拽通过 handleCommitProjectOrder 改变这个数组。
  // 老版本在这里 sort 是为了给 backend 写入的"任意"顺序提供一个稳定视觉,
  // 现在改由 init 时一次性迁移 + 用户拖拽决定。
  const railProjects = projects;
  const mountedProjects = useMemo(
    () =>
      mountedProjectIds
        .map((id) => projects.find((project) => project.id === id))
        .filter((project): project is Project => !!project),
    [mountedProjectIds, projects],
  );

  // 看板入口在 ProjectRail 底部触发,打开全屏浮层覆盖当前页面。
  // 不切换 activeProject,关闭浮层后用户回到原先所在的任务上下文。
  useEffect(() => {
    const handle = () => setShowKanban(true);
    window.addEventListener(OPEN_KANBAN_VIEW_EVENT, handle);
    return () => window.removeEventListener(OPEN_KANBAN_VIEW_EVENT, handle);
  }, []);

  // 从看板跳转到某个项目（可选定位到具体 task）。关浮层 + 切活动项目
  // + 在该项目的本地视图状态里选中 task。三步必须一起做,任何一步漏掉都会让用户看到
  // 错位的页面状态。
  function enterProjectFromKanban(project: Project, taskId?: string) {
    setShowKanban(false);
    handleProjectClick(project);
    if (taskId) {
      updateProjectView(project.id, { selectedTaskId: taskId, isNewTask: false });
    }
  }

  // toast 点击回跳消费（docs/actions/260817 阶段 2）。写入侧在 App.tsx
  // （面板卸载时也要有人接住事件），桥是「留货待取」：面板挂载中走订阅
  // 即时导航；刚挂载（SSH 视图切回/应用被 toast 冷拉起）由下方无依赖数组
  // 的 effect 在 tasks 就绪后取走积压——任务查找命中才 consume，挂载初期
  // tasks 尚未加载完不会误丢导航。任务已删除（残留通知）则不导航，滞留
  // 桥中无害。
  function navigateFromPendingNavigation() {
    const pending = peekPendingCodingNavigation();
    if (!pending) return;
    const task = tasks.find((t) => t.id === pending.taskId);
    if (!task) return;
    consumePendingCodingNavigation();
    const project = projects.find((p) => p.id === task.projectId);
    if (project) {
      enterProjectFromKanban(project, task.id);
    }
  }

  // tasks/projects 每次变化都重试积压导航（覆盖挂载早于任务加载完成的窗口期）
  useEffect(() => {
    navigateFromPendingNavigation();
  });

  // 面板挂载中收到点击（订阅即时导航，与上面的重试共用同一入口）
  useEffect(() => {
    return subscribePendingCodingNavigation(() => navigateFromPendingNavigation());
  });

  return (
    <div ref={rootRef} className="ai-coding-root" style={s.rootRelative}>
      <div style={s.appProjectLayer}>
        {mountedProjects.map((project) => {
          const view = getProjectView(project.id);
          return (
            <ProjectPage
              key={project.id}
              project={project}
              visible={activeProject?.id === project.id}
              allProjects={railProjects}
              otherProjects={sortedProjects.filter((p) => p.id !== project.id)}
              tasks={tasks}
              getTaskRestoreState={tm.getTaskRestoreState}
              taskRunCounts={taskRunCounts}
              selectedTaskId={view.selectedTaskId}
              isNewTask={view.isNewTask}
              onNewTask={() =>
                updateProjectView(project.id, { selectedTaskId: null, isNewTask: true })
              }
              onSelectTask={(id) =>
                updateProjectView(project.id, { selectedTaskId: id, isNewTask: false })
              }
              onDeleteTask={handleDeleteTask}
              onDeleteAllTasks={() => handleDeleteAllTasks(project)}
              onToggleTaskStar={handleToggleTaskStar}
              onRenameTask={handleRenameTask}
              onGenerateTaskName={handleGenerateTaskName}
              onSubmitTask={(taskInput) => handleSubmitTask(project, taskInput)}
              onRunTodoTask={handleRunTodoTask}
              onUpdateTodo={handleUpdateTodo}
              onCancelTask={handleCancelTask}
              onResumeTask={handleResumeTask}
              onForkTask={handleForkTask}
              onReconnectTask={handleReconnectTask}
              onMarkTaskDone={handleMarkTaskDone}
              onInput={tm.handleInput}
              onResize={tm.handleResize}
              onRegisterTerminal={tm.handleRegisterTerminal}
              onTerminalReady={handleTerminalReady}
              onSnapshot={tm.handleSnapshot}
              onBack={handleBack}
              onSwitchProject={handleProjectClick}
              onCommitProjectOrder={handleCommitProjectOrder}
              onOpen={handleOpen}
              themeVariant={THEME_VARIANT}
              terminalFontSize={terminalFontSize}
              onTerminalFontSizeChange={setTerminalFontSize}
              taskDisplayWindow={taskDisplayWindow}
              onTaskDisplayWindowChange={setTaskDisplayWindow}
              attentionBadge={attentionBadge}
              onAttentionBadgeChange={setAttentionBadge}
              terminalScrollback={terminalScrollback}
              onTerminalScrollbackChange={handleTerminalScrollbackChange}
              uiFontFamily={uiFontFamily}
              onUiFontFamilyChange={setUiFontFamily}
              monoFontFamily={monoFontFamily}
              onMonoFontFamilyChange={setMonoFontFamily}
            />
          );
        })}
      </div>
      {showKanban && (
        <div style={s.kanbanOverlay}>
          <KanbanView
            projects={sortedProjects}
            tasks={tasks}
            onClose={() => setShowKanban(false)}
            onTaskClick={(task) => {
              const project = projects.find((p) => p.id === task.projectId);
              if (project) enterProjectFromKanban(project, task.id);
            }}
            onProjectClick={(project) => enterProjectFromKanban(project)}
          />
        </div>
      )}
      {!activeProject && (
        <div style={s.appWelcomeLayer}>
          <WelcomePage
            projects={sortedProjects}
            onOpen={handleOpen}
            onProjectClick={handleProjectClick}
            onDeleteProject={handleDeleteProject}
            onToggleProjectHidden={handleToggleProjectHidden}
            onRenameProject={handleRenameProject}
            terminalFontSize={terminalFontSize}
            onTerminalFontSizeChange={setTerminalFontSize}
            taskDisplayWindow={taskDisplayWindow}
            onTaskDisplayWindowChange={setTaskDisplayWindow}
            attentionBadge={attentionBadge}
            onAttentionBadgeChange={setAttentionBadge}
            terminalScrollback={terminalScrollback}
            onTerminalScrollbackChange={handleTerminalScrollbackChange}
            uiFontFamily={uiFontFamily}
            onUiFontFamilyChange={setUiFontFamily}
            monoFontFamily={monoFontFamily}
            onMonoFontFamilyChange={setMonoFontFamily}
          />
        </div>
      )}
    </div>
  );
}

export default App;
