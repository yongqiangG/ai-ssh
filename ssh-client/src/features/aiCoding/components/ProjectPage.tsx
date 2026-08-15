import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type {
  Project,
  Task,
  AgentType,
  PermissionMode,
  TaskStatus,
  ThemeVariant,
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
  FontFamily,
} from "../types";
import { TaskPanel } from "./TaskPanel";
import { NewTaskView, type NewTaskDraft } from "./NewTaskView";
import { RunningView } from "./RunningView";
import { FileExplorer } from "./FileExplorer";
import { FileSearchDialog } from "./file-explorer/SearchPanel";
import { FileViewer } from "./FileViewer";
import { ProjectRail } from "./ProjectRail";
import { SettingsDialog } from "./SettingsDialog";
import { RightToolbar } from "./RightToolbar";
import { TodoTaskView } from "./TodoTaskView";
import { ShellTerminalPanel, type ShellTerminalPanelHandle } from "./ShellTerminalPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { useToast } from "./Toast";
import { useProjectPanels } from "../hooks/useProjectPanels";
import { useI18n } from "../i18n";
import s from "../styles";

export function ProjectPage({
  project,
  visible = true,
  allProjects = [],
  otherProjects = [],
  tasks,
  getTaskRestoreState,
  taskRunCounts,
  selectedTaskId,
  isNewTask,
  onNewTask,
  onSelectTask,
  onDeleteTask,
  onDeleteAllTasks,
  onToggleTaskStar,
  onRenameTask,
  onGenerateTaskName,
  onSubmitTask,
  onRunTodoTask,
  onUpdateTodo,
  onCancelTask,
  onResumeTask,
  onForkTask,
  onReconnectTask,
  onMarkTaskDone,
  onInput,
  onResize,
  onRegisterTerminal,
  onTerminalReady,
  onSnapshot,
  onBack,
  onSwitchProject,
  onCommitProjectOrder,
  onOpen,
  themeVariant,
  terminalFontSize,
  onTerminalFontSizeChange,
  taskDisplayWindow,
  onTaskDisplayWindowChange,
  attentionBadge,
  onAttentionBadgeChange,
  terminalScrollback,
  onTerminalScrollbackChange,
  uiFontFamily,
  onUiFontFamilyChange,
  monoFontFamily,
  onMonoFontFamilyChange,
}: {
  project: Project;
  visible?: boolean;
  allProjects?: Project[];
  otherProjects?: Project[];
  tasks: Task[];
  getTaskRestoreState: (taskId: string) => { initialData?: string; initialSnapshot?: string };
  taskRunCounts: Record<string, number>;
  selectedTaskId: string | null;
  isNewTask: boolean;
  onNewTask: () => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onDeleteAllTasks: () => void;
  onToggleTaskStar: (id: string) => void;
  onRenameTask: (id: string, name: string) => void;
  onGenerateTaskName: (id: string) => Promise<void>;
  onSubmitTask: (t: {
    prompt: string;
    agent: AgentType;
    permissionMode: PermissionMode;
    model?: string;
    reasoningEffort?: string;
    images: string[];
    texts: string[];
    immediate: boolean;
  }) => void;
  onRunTodoTask: (task: Task) => void;
  onUpdateTodo: (
    taskId: string,
    updates: { prompt: string; agent: AgentType; permissionMode: PermissionMode },
  ) => void;
  onCancelTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onForkTask: (id: string, name: string) => void;
  onReconnectTask: (id: string) => void;
  onMarkTaskDone: (id: string) => void;
  onInput: (taskId: string, data: string) => void;
  onResize: (taskId: string, cols: number, rows: number) => void;
  onRegisterTerminal: (
    taskId: string,
    writeFn: ((data: string, callback?: () => void) => void) | null,
  ) => number;
  onTerminalReady: (taskId: string, generation: number) => void;
  onSnapshot: (taskId: string, snapshot: string) => void;
  onBack: () => void;
  onSwitchProject: (project: Project) => void;
  onCommitProjectOrder: (draggedId: string, beforeId: string | null, visibleIds: string[]) => void;
  onOpen: () => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  onTerminalFontSizeChange: (size: TerminalFontSize) => void;
  taskDisplayWindow: TaskDisplayWindow;
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
  attentionBadge: boolean;
  onAttentionBadgeChange: (enabled: boolean) => void;
  terminalScrollback: TerminalScrollback;
  onTerminalScrollbackChange: (value: TerminalScrollback) => void;
  uiFontFamily: FontFamily;
  onUiFontFamilyChange: (family: FontFamily) => void;
  monoFontFamily: FontFamily;
  onMonoFontFamilyChange: (family: FontFamily) => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const {
    rightPanel,
    openFiles,
    activeFilePath,
    rightPanelWidth,
    terminalHeight,
    openRightPanel,
    handleTogglePanel,
    handleFileSelect,
    handleFileTabSelect,
    handleFileTabClose,
    handleCloseOtherFileTabs,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFileTabs,
    clearFiles,
    handleRightResizeStart,
    handleTerminalResizeStart,
  } = useProjectPanels();

  const [showShellTerminal, setShowShellTerminal] = useState(false);
  const [shellProjectPath, setShellProjectPath] = useState(project.path);
  const [showSettings, setShowSettings] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [taskPanelCollapsed, setTaskPanelCollapsed] = useState(false);
  const [mountedTaskIds, setMountedTaskIds] = useState<Set<string>>(() => new Set());
  const shellRef = useRef<ShellTerminalPanelHandle>(null);
  const pendingCmdRef = useRef<string | null>(null);
  const newTaskDraftRef = useRef<NewTaskDraft | null>(null);
  const handleCacheNewTaskDraft = useCallback((draft: NewTaskDraft | null) => {
    newTaskDraftRef.current = draft;
  }, []);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === project.id),
    [tasks, project.id],
  );
  const selectedTask = projectTasks.find((t) => t.id === selectedTaskId) ?? null;

  const handleSearchFileSelect = useCallback(
    (path: string, name: string) => {
      handleFileSelect(path, name);
      openRightPanel("files");
    },
    [handleFileSelect, openRightPanel],
  );

  // 只挂载当前选中的任务的 xterm 实例，其他任务通过 snapshot 序列化后卸载。
  // 这样同时只有 1 个 WebGL context 存活，避免长时间运行后 GPU 内存累积。
  useEffect(() => {
    if (selectedTaskId && !isNewTask) {
      setMountedTaskIds((prev) => {
        if (prev.size === 1 && prev.has(selectedTaskId)) return prev;
        return new Set([selectedTaskId]);
      });
    }
  }, [selectedTaskId, isNewTask]);

  const handleSelectTask = useCallback(
    (id: string) => {
      clearFiles();
      onSelectTask(id);
    },
    [onSelectTask, clearFiles],
  );

  const handleRunMakeTarget = useCallback(
    (target: string) => {
      const cmd = `make ${target}\n`;
      if (showShellTerminal && shellRef.current) {
        const sent = shellRef.current.sendCommandToPath(project.path, cmd);
        if (!sent) {
          showToast(t("terminal.limitReachedWithCloseHint"), "warning");
        }
      } else {
        setShellProjectPath(project.path);
        pendingCmdRef.current = cmd;
        setShowShellTerminal(true);
      }
    },
    [project.path, showShellTerminal, showToast, t],
  );

  const handleToggleShellTerminal = useCallback(() => {
    setShowShellTerminal((currentlyVisible) => {
      if (!currentlyVisible) {
        setShellProjectPath(project.path);
      }
      return !currentlyVisible;
    });
  }, [project.path]);

  useEffect(() => {
    if (showShellTerminal) return;
    setShellProjectPath(project.path);
  }, [project.id, project.path, showShellTerminal]);

  const handleShellReady = useCallback(() => {
    if (pendingCmdRef.current) {
      shellRef.current?.sendCommand(pendingCmdRef.current);
      pendingCmdRef.current = null;
    }
  }, []);

  const handleShellClose = useCallback(() => {
    setShowShellTerminal(false);
    setShellProjectPath(project.path);
  }, [project.path]);

  const handleNewTask = useCallback(() => {
    clearFiles();
    onNewTask();
  }, [onNewTask, clearFiles]);

  return (
    <div style={visible ? s.projectBodyVisible : s.projectBodyHidden}>
      <ProjectRail
        projects={allProjects}
        allTasks={tasks}
        activeProjectId={project.id}
        attentionBadge={attentionBadge}
        onSwitch={onSwitchProject}
        onCommitProjectOrder={onCommitProjectOrder}
        onOpen={onOpen}
      />
      <TaskPanel
        project={project}
        tasks={projectTasks}
        selectedId={selectedTaskId}
        isNewTask={isNewTask}
        onNewTask={handleNewTask}
        onSelectTask={handleSelectTask}
        onDeleteTask={onDeleteTask}
        onDeleteAllTasks={onDeleteAllTasks}
        onToggleTaskStar={onToggleTaskStar}
        onRunTodo={onRunTodoTask}
        onBack={onBack}
        terminalFontSize={terminalFontSize}
        onTerminalFontSizeChange={onTerminalFontSizeChange}
        taskDisplayWindow={taskDisplayWindow}
        onTaskDisplayWindowChange={onTaskDisplayWindowChange}
        attentionBadge={attentionBadge}
        onAttentionBadgeChange={onAttentionBadgeChange}
        terminalScrollback={terminalScrollback}
        onTerminalScrollbackChange={onTerminalScrollbackChange}
        uiFontFamily={uiFontFamily}
        onUiFontFamilyChange={onUiFontFamilyChange}
        monoFontFamily={monoFontFamily}
        onMonoFontFamilyChange={onMonoFontFamilyChange}
        collapsed={taskPanelCollapsed}
        onToggleCollapsed={() => setTaskPanelCollapsed((v) => !v)}
      />
      <div style={s.mainContent}>
        <div style={s.projectMainStage}>
          {/* Foreground: file viewer or new-task composer */}
          <ErrorBoundary
            label="主内容区"
            fallback={(error, reset) => (
              <div style={s.errorBoundaryWrap}>
                <div style={s.errorBoundaryIcon}>⚠</div>
                <div style={s.errorBoundaryTitle}>内容区渲染出错</div>
                <div style={s.errorBoundaryMessage}>{error.message || "未知错误"}</div>
                <div style={s.errorBoundaryActions}>
                  <button onClick={reset} style={s.errorBoundaryBtn}>
                    重试
                  </button>
                  <button
                    onClick={() => {
                      clearFiles();
                      reset();
                    }}
                    style={s.errorBoundaryBtn}
                  >
                    返回任务视图
                  </button>
                </div>
              </div>
            )}
          >
            {openFiles.length > 0 ? (
              <FileViewer
                tabs={openFiles}
                activeFilePath={activeFilePath}
                projectPath={project.path}
                onSelectTab={handleFileTabSelect}
                onCloseTab={handleFileTabClose}
                onCloseOtherTabs={handleCloseOtherFileTabs}
                onCloseTabsToRight={handleCloseTabsToRight}
                onCloseTabsToLeft={handleCloseTabsToLeft}
                onCloseAllTabs={handleCloseAllFileTabs}
                themeVariant={themeVariant}
                onRunMakeTarget={handleRunMakeTarget}
              />
            ) : isNewTask || !selectedTask ? (
              <NewTaskView
                project={project}
                otherProjects={otherProjects}
                onSubmit={onSubmitTask}
                initialDraft={newTaskDraftRef.current}
                onCacheDraft={handleCacheNewTaskDraft}
              />
            ) : selectedTask.status === ("todo" as TaskStatus) ? (
              <TodoTaskView
                task={selectedTask}
                onRunTodo={onRunTodoTask}
                onUpdateTodo={onUpdateTodo}
              />
            ) : null}
          </ErrorBoundary>

          {/* Background terminals */}
          {projectTasks
            .filter((t) => mountedTaskIds.has(t.id))
            .map((task) => {
              const isVisible =
                openFiles.length === 0 &&
                !isNewTask &&
                !!selectedTask &&
                task.id === selectedTaskId &&
                task.status !== "todo";
              return (
                <RunningView
                  key={task.id}
                  task={task}
                  projectPath={project.path}
                  runCount={taskRunCounts[task.id] ?? 0}
                  visible={visible && isVisible}
                  projectActive={visible}
                  onCancel={() => onCancelTask(task.id)}
                  onResume={() => onResumeTask(task.id)}
                  onFork={(name) => onForkTask(task.id, name)}
                  onReconnect={() => onReconnectTask(task.id)}
                  onMarkDone={() => onMarkTaskDone(task.id)}
                  onInput={(data) => onInput(task.id, data)}
                  onResize={(cols, rows) => onResize(task.id, cols, rows)}
                  onRegisterTerminal={(fn) => onRegisterTerminal(task.id, fn)}
                  onTerminalReady={(generation) => onTerminalReady(task.id, generation)}
                  onSnapshot={(snapshot) => onSnapshot(task.id, snapshot)}
                  getRestoreState={() => getTaskRestoreState(task.id)}
                  onRename={(name) => onRenameTask(task.id, name)}
                  onGenerateName={() => onGenerateTaskName(task.id)}
                  themeVariant={themeVariant}
                  terminalFontSize={terminalFontSize}
                  terminalScrollback={terminalScrollback}
                  monoFontFamily={monoFontFamily}
                />
              );
            })}
        </div>
        {showShellTerminal && (
          <ShellTerminalPanel
            ref={shellRef}
            projectPath={shellProjectPath}
            projectId={project.id}
            isActive={visible}
            onClose={handleShellClose}
            themeVariant={themeVariant}
            terminalFontSize={terminalFontSize}
            monoFontFamily={monoFontFamily}
            onReady={handleShellReady}
            height={terminalHeight}
            onResizeStart={handleTerminalResizeStart}
          />
        )}
      </div>

      {rightPanel && (
        <div style={s.rightPanelWrap}>
          <div onMouseDown={handleRightResizeStart} style={s.rightPanelResizeHandle} />
          {rightPanel === "files" && (
            <ErrorBoundary label="文件浏览器">
              <FileExplorer
                projectPath={project.path}
                projectName={project.name}
                onFileSelect={handleFileSelect}
                active={visible}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
        </div>
      )}

      <RightToolbar
        activePanel={rightPanel}
        onToggle={handleTogglePanel}
        terminalActive={showShellTerminal}
        onToggleTerminal={handleToggleShellTerminal}
        onOpenSearch={() => setShowFileSearch(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {showFileSearch && (
        <FileSearchDialog
          projectPath={project.path}
          onFileSelect={handleSearchFileSelect}
          onClose={() => setShowFileSearch(false)}
        />
      )}

      {showSettings && (
        <SettingsDialog projectPath={project.path} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
