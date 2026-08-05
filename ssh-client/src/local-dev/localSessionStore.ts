import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type LocalAgent = "claude" | "codex";
export type LocalPermissionMode = "ask" | "auto_edit" | "full_access";
export type LocalTaskOperation = "run" | "resume" | "fork";
export type LocalSessionStatus =
  "history" | "running" | "done" | "failed" | "cancelled";

export interface LocalSession {
  taskId: string;
  projectPath: string;
  agent: LocalAgent;
  status: LocalSessionStatus;
  sessionId?: string;
  sessionPath?: string;
  title: string;
  prompt?: string;
  permissionMode: LocalPermissionMode;
  operation: LocalTaskOperation;
  sourceSessionId?: string;
  fileRefs: string[];
  images: string[];
  texts: string[];
  modifiedAt: number;
}

export interface SessionHistoryDTO {
  agent: LocalAgent;
  sessionId: string;
  sessionPath?: string;
  title: string;
  modifiedAt: number;
}

interface TaskStatusEvent {
  taskId: string;
  status: LocalSessionStatus;
}

interface TaskSessionEvent {
  taskId: string;
  agent: LocalAgent;
  sessionId: string;
  sessionPath?: string;
  title?: string;
  modifiedAt?: number;
}

interface LocalSessionState {
  sessions: LocalSession[];
  activeTaskId: string | null;
  startTask: (input: {
    projectPath: string;
    agent: LocalAgent;
    prompt: string;
    permissionMode?: LocalPermissionMode;
    operation?: LocalTaskOperation;
    sourceSessionId?: string;
    fileRefs?: string[];
    images?: string[];
    texts?: string[];
  }) => LocalSession;
  selectSession: (taskId: string | null) => void;
  updateStatus: (event: TaskStatusEvent) => void;
  attachSession: (event: TaskSessionEvent) => void;
  mergeHistory: (projectPath: string, history: SessionHistoryDTO[]) => void;
  loadHistory: (projectPath: string) => Promise<void>;
  removeTask: (taskId: string) => void;
}

let taskSequence = 0;

export function createLocalTaskId(): string {
  taskSequence += 1;
  return "local-" + Date.now().toString(36) + "-" + taskSequence.toString(36);
}

function sortSessions(sessions: LocalSession[]): LocalSession[] {
  return [...sessions].sort(
    (left, right) => right.modifiedAt - left.modifiedAt,
  );
}

function historyTaskId(session: SessionHistoryDTO): string {
  return "history:" + session.agent + ":" + session.sessionId;
}

export const useLocalSessionStore = create<LocalSessionState>((set) => ({
  sessions: [],
  activeTaskId: null,

  startTask: ({
    projectPath,
    agent,
    prompt,
    permissionMode = "ask",
    operation = "run",
    sourceSessionId,
    fileRefs = [],
    images = [],
    texts = [],
  }) => {
    const task: LocalSession = {
      taskId: createLocalTaskId(),
      projectPath,
      agent,
      status: "running",
      title: prompt.trim().split(/\s+/).slice(0, 8).join(" ") || "新建会话",
      prompt,
      permissionMode,
      operation,
      sourceSessionId,
      fileRefs,
      images,
      texts,
      modifiedAt: Date.now(),
    };
    set((state) => ({
      sessions: [
        task,
        ...state.sessions.filter((item) => item.taskId !== task.taskId),
      ],
      activeTaskId: task.taskId,
    }));
    return task;
  },

  selectSession: (taskId) => set({ activeTaskId: taskId }),

  updateStatus: ({ taskId, status }) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.taskId === taskId
          ? { ...session, status, modifiedAt: Date.now() }
          : session,
      ),
    })),

  attachSession: ({
    taskId,
    agent,
    sessionId,
    sessionPath,
    title,
    modifiedAt,
  }) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.taskId === taskId
          ? {
              ...session,
              agent,
              sessionId,
              sessionPath,
              title: title || session.title,
              modifiedAt: modifiedAt ?? Date.now(),
            }
          : session,
      ),
    })),

  mergeHistory: (projectPath, history) =>
    set((state) => {
      const active = state.sessions.filter(
        (session) =>
          session.projectPath === projectPath && session.status !== "history",
      );
      const otherProjects = state.sessions.filter(
        (session) => session.projectPath !== projectPath,
      );
      const historySessions = history.map((item) => ({
        taskId: historyTaskId(item),
        projectPath,
        agent: item.agent,
        status: "history" as const,
        sessionId: item.sessionId,
        sessionPath: item.sessionPath,
        title: item.title || "历史会话",
        permissionMode: "ask" as LocalPermissionMode,
        operation: "resume" as LocalTaskOperation,
        fileRefs: [],
        images: [],
        texts: [],
        modifiedAt: item.modifiedAt,
      }));
      return {
        sessions: sortSessions([
          ...otherProjects,
          ...active,
          ...historySessions,
        ]),
      };
    }),

  loadHistory: async (projectPath) => {
    const results = await Promise.all(
      (["claude", "codex"] as const).map((agent) =>
        invoke<SessionHistoryDTO[]>("discover_sessions", {
          projectPath,
          agent,
        }).catch(() => []),
      ),
    );
    useLocalSessionStore.getState().mergeHistory(projectPath, results.flat());
  },

  removeTask: (taskId) =>
    set((state) => ({
      sessions: state.sessions.filter((session) => session.taskId !== taskId),
      activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
    })),
}));

export function applyTaskStatusEvent(event: TaskStatusEvent): void {
  useLocalSessionStore.getState().updateStatus(event);
}

export function applyTaskSessionEvent(event: TaskSessionEvent): void {
  useLocalSessionStore.getState().attachSession(event);
}
