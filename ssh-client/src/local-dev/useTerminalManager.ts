import { useMemo } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type {
  LocalAgent,
  LocalPermissionMode,
  LocalTaskOperation,
} from "./localSessionStore";
import {
  appendOutput,
  createOutputBuffer,
  drainOutputFrame,
  snapshotOutput,
  type OutputBuffer,
} from "./terminalBuffer";

export interface LocalTerminalLaunch {
  taskId: string;
  projectPath: string;
  agent: LocalAgent;
  permissionMode: LocalPermissionMode;
  operation: LocalTaskOperation;
  prompt?: string;
  sessionId?: string;
  images?: string[];
  texts?: string[];
}

interface ManagedLocalTerminal {
  task: LocalTerminalLaunch;
  terminal: Terminal;
  fitAddon: FitAddon;
  output: OutputBuffer;
  pendingOutput: string[];
  channel: Channel<string>;
  container: HTMLElement | null;
  opening: Promise<void> | null;
  ready: boolean;
  alive: boolean;
  inputBuffer: string;
  inputTimer: number | null;
  frameHandle: number | null;
  resizeObserver: ResizeObserver | null;
  lastCols: number;
  lastRows: number;
}

export interface LocalTerminalManager {
  open: (task: LocalTerminalLaunch, container: HTMLElement) => Promise<void>;
  attach: (taskId: string, container: HTMLElement) => void;
  fit: (taskId: string) => void;
  focus: (taskId: string) => void;
  sendInput: (taskId: string, data: string) => Promise<void>;
  resize: (taskId: string, cols: number, rows: number) => Promise<void>;
  cancel: (taskId: string, projectPath?: string) => Promise<void>;
  complete: (taskId: string, projectPath?: string) => Promise<void>;
  dispose: (taskId: string) => void;
  has: (taskId: string) => boolean;
  snapshot: (taskId: string) => string;
}

const terminals = new Map<string, ManagedLocalTerminal>();
const opening = new Set<string>();

function readXtermTheme() {
  const css = getComputedStyle(document.documentElement);
  return {
    background: css.getPropertyValue("--terminal-bg").trim() || "#07080f",
    foreground: css.getPropertyValue("--terminal-fg").trim() || "#ccd2e8",
    cursor: css.getPropertyValue("--terminal-cursor").trim() || "#00e5ff",
    cursorAccent: css.getPropertyValue("--terminal-bg").trim() || "#07080f",
    selectionBackground: "rgba(0, 229, 255, 0.25)",
  };
}

function scheduleFrame(managed: ManagedLocalTerminal): void {
  if (
    !managed.alive ||
    !managed.ready ||
    managed.pendingOutput.length === 0 ||
    managed.frameHandle !== null
  ) {
    return;
  }

  managed.frameHandle = window.requestAnimationFrame(() => {
    managed.frameHandle = null;
    if (!managed.alive || !managed.ready) return;

    const frame = drainOutputFrame(managed.pendingOutput);
    managed.pendingOutput = frame.remaining;
    if (frame.text) managed.terminal.write(frame.text);
    scheduleFrame(managed);
  });
}

function enqueueOutput(managed: ManagedLocalTerminal, chunk: string): void {
  if (!managed.alive || !chunk) return;
  appendOutput(managed.output, chunk);
  managed.pendingOutput.push(chunk);
  scheduleFrame(managed);
}

function flushInput(managed: ManagedLocalTerminal): void {
  managed.inputTimer = null;
  const data = managed.inputBuffer;
  managed.inputBuffer = "";
  if (!managed.alive || !data) return;
  void managerSendInput(managed.task.taskId, data);
}

function queueInput(managed: ManagedLocalTerminal, data: string): void {
  if (!managed.alive || !data) return;
  managed.inputBuffer += data;
  if (managed.inputTimer === null) {
    managed.inputTimer = window.setTimeout(() => flushInput(managed), 10);
  }
}

function observeContainer(
  managed: ManagedLocalTerminal,
  container: HTMLElement,
): void {
  managed.resizeObserver?.disconnect();
  managed.resizeObserver = new ResizeObserver(() => {
    if (
      managed.alive &&
      container.clientWidth > 0 &&
      container.clientHeight > 0
    ) {
      try {
        managed.fitAddon.fit();
      } catch {
        // The host can be detached between ResizeObserver and fit().
      }
    }
  });
  managed.resizeObserver.observe(container);
}

function attachElement(
  managed: ManagedLocalTerminal,
  container: HTMLElement,
): void {
  const element = managed.terminal.element;
  if (!element) return;
  if (element.parentElement !== container) container.appendChild(element);
  managed.container = container;
  observeContainer(managed, container);
  if (
    managed.alive &&
    container.clientWidth > 0 &&
    container.clientHeight > 0
  ) {
    try {
      managed.fitAddon.fit();
    } catch {
      // A hidden host may not have a measurable layout yet.
    }
  }
  scheduleFrame(managed);
}

function launchArguments(managed: ManagedLocalTerminal): {
  command: string;
  args: Record<string, unknown>;
} {
  const task = managed.task;
  const common = {
    taskId: task.taskId,
    projectPath: task.projectPath,
    agent: task.agent,
    permissionMode: task.permissionMode,
    cols: managed.terminal.cols,
    rows: managed.terminal.rows,
    onOutput: managed.channel,
  };

  if (task.operation === "run") {
    return {
      command: "run_task",
      args: {
        ...common,
        prompt: task.prompt ?? "",
        images: task.images ?? [],
        texts: task.texts ?? [],
      },
    };
  }

  if (!task.sessionId) {
    throw new Error("local session id is required for this operation");
  }

  if (task.operation === "resume") {
    return {
      command: "resume_task",
      args: { ...common, sessionId: task.sessionId },
    };
  }

  return {
    command: "fork_task",
    args: { ...common, sourceSessionId: task.sessionId },
  };
}

async function launch(managed: ManagedLocalTerminal): Promise<void> {
  const { command, args } = launchArguments(managed);
  await invoke<void>(command, args);
  managed.ready = true;
  scheduleFrame(managed);
}

function showLaunchError(managed: ManagedLocalTerminal, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const output =
    "\r\n\x1b[31mLocal agent failed to start: " + message + "\x1b[0m\r\n";
  appendOutput(managed.output, output);
  managed.terminal.write(output);
}

async function openTerminal(
  task: LocalTerminalLaunch,
  container: HTMLElement,
): Promise<void> {
  const existing = terminals.get(task.taskId);
  if (existing) {
    attachElement(existing, container);
    if (existing.opening) await existing.opening;
    return;
  }
  if (opening.has(task.taskId)) return;
  opening.add(task.taskId);

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    scrollback: 5000,
    theme: readXtermTheme(),
  });
  const fitAddon = new FitAddon();
  const channel = new Channel<string>();
  const managed: ManagedLocalTerminal = {
    task,
    terminal,
    fitAddon,
    output: createOutputBuffer(),
    pendingOutput: [],
    channel,
    container,
    opening: null,
    ready: false,
    alive: true,
    inputBuffer: "",
    inputTimer: null,
    frameHandle: null,
    resizeObserver: null,
    lastCols: 0,
    lastRows: 0,
  };

  terminal.loadAddon(fitAddon);
  terminal.open(container);
  terminals.set(task.taskId, managed);
  channel.onmessage = (chunk) => enqueueOutput(managed, chunk);
  terminal.onData((data) => queueInput(managed, data));
  terminal.onResize(({ cols, rows }) => {
    if (
      !managed.alive ||
      !managed.ready ||
      (cols === managed.lastCols && rows === managed.lastRows)
    ) {
      return;
    }
    managed.lastCols = cols;
    managed.lastRows = rows;
    void managerResize(task.taskId, cols, rows);
  });
  observeContainer(managed, container);
  try {
    fitAddon.fit();
  } catch {
    // The host will fit again when it becomes visible.
  }
  managed.lastCols = terminal.cols;
  managed.lastRows = terminal.rows;

  const openingPromise = launch(managed);
  managed.opening = openingPromise;
  try {
    await openingPromise;
    terminal.focus();
  } catch (error) {
    showLaunchError(managed, error);
    throw error;
  } finally {
    managed.opening = null;
    opening.delete(task.taskId);
  }
}

async function managerSendInput(taskId: string, data: string): Promise<void> {
  await invoke<void>("send_input", { taskId, data });
}

async function managerResize(
  taskId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke<void>("resize_pty", { taskId, cols, rows });
}

async function managerCancel(
  taskId: string,
  projectPath?: string,
): Promise<void> {
  await invoke<void>("cancel_task", { taskId, projectPath });
}

async function managerComplete(
  taskId: string,
  projectPath?: string,
): Promise<void> {
  await invoke<void>("complete_task", { taskId, projectPath });
}

function managerAttach(taskId: string, container: HTMLElement): void {
  const managed = terminals.get(taskId);
  if (managed) attachElement(managed, container);
}

function managerFit(taskId: string): void {
  const managed = terminals.get(taskId);
  if (!managed?.alive) return;
  try {
    managed.fitAddon.fit();
  } catch {
    // The host may be between unmount and re-attach.
  }
}

function managerFocus(taskId: string): void {
  terminals.get(taskId)?.terminal.focus();
}

function managerDispose(taskId: string): void {
  const managed = terminals.get(taskId);
  if (!managed) return;
  managed.alive = false;
  if (managed.inputTimer !== null) window.clearTimeout(managed.inputTimer);
  if (managed.frameHandle !== null) {
    window.cancelAnimationFrame(managed.frameHandle);
  }
  managed.resizeObserver?.disconnect();
  managed.terminal.dispose();
  terminals.delete(taskId);
  opening.delete(taskId);
}

const manager: LocalTerminalManager = {
  open: openTerminal,
  attach: managerAttach,
  fit: managerFit,
  focus: managerFocus,
  sendInput: managerSendInput,
  resize: managerResize,
  cancel: managerCancel,
  complete: managerComplete,
  dispose: managerDispose,
  has: (taskId) => terminals.has(taskId),
  snapshot: (taskId) => {
    const managed = terminals.get(taskId);
    return managed ? snapshotOutput(managed.output) : "";
  },
};

export function useTerminalManager(): LocalTerminalManager {
  return useMemo(() => manager, []);
}

export function getLocalTerminalSnapshot(taskId: string): string {
  return manager.snapshot(taskId);
}
