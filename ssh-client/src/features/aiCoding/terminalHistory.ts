import { create } from "zustand";
import type { Task } from "./types";

/**
 * 终端展示历史（需求-终端后退，2026-09-11 grill 决议）：浏览器指针模型的
 * 「真正看到过」的任务终端序列，Ctrl+Alt+←/→ 在其中后退/前进。
 *
 * 独立于四条跳转链路（横幅/toast/手机跟随/恢复）与删除入口——记录靠派生
 * effect 旁观「当前可见终端」，导航时校验目标存在、跳过死链，历史永不
 * 主动清理。仅会话内存，重启清零（决议 10）。
 */

export interface TerminalHistoryEntry {
  projectId: string;
  taskId: string;
}

/** entries 上限（决议 9）：溢出丢最老，远超实际交互深度，仅防长会话无界增长。 */
export const HISTORY_MAX_ENTRIES = 50;

function sameEntry(a: TerminalHistoryEntry, b: TerminalHistoryEntry): boolean {
  return a.projectId === b.projectId && a.taskId === b.taskId;
}

interface TerminalHistoryState {
  /** 按展示顺序排列的终端条目（最老在前） */
  entries: TerminalHistoryEntry[];
  /** 当前位置索引；-1 = 空 */
  pointer: number;
  /** back/forward 置下的「导航意图」条目：随后的画面记录若匹配则被吸收（不 append） */
  suppress: TerminalHistoryEntry | null;
}

export const useTerminalHistoryStore = create<TerminalHistoryState>(() => ({
  entries: [],
  pointer: -1,
  suppress: null,
}));

/**
 * 「当前可见终端」的判定（记录时机，决议 3 + 6）：面板激活、有激活项目、
 * 不在新任务表单、选中了终端态任务（todo 画面不是终端）。文件查看器盖住
 * 终端时不调用本模块（由调用侧的派生值决定），画面语义见需求文档。
 */
export function deriveVisibleTerminal(input: {
  panelActive: boolean;
  activeProjectId: string | null;
  isNewTask: boolean;
  selectedTaskId: string | null;
  selectedTask: Task | undefined;
}): TerminalHistoryEntry | null {
  if (!input.panelActive) return null;
  if (input.activeProjectId == null) return null;
  if (input.isNewTask || !input.selectedTaskId) return null;
  if (!input.selectedTask || input.selectedTask.status === "todo") return null;
  return { projectId: input.activeProjectId, taskId: input.selectedTaskId };
}

/**
 * 画面记录入口（记录 effect 每次派生值变化调用）：
 * null（离开终端画面）→ 不入史不清史；
 * 与指针当前条目相同 → 去重；
 * 指针在末尾 → append（超上限丢最老）；
 * 指针不在末尾 → 截断前向尾巴再 append（浏览器模型，决议 2）。
 */
export function recordTerminalView(entry: TerminalHistoryEntry | null): void {
  if (!entry) return;
  useTerminalHistoryStore.setState((s) => {
    if (s.pointer >= 0 && sameEntry(s.entries[s.pointer], entry)) return s;
    const keep = s.entries.slice(0, s.pointer + 1);
    keep.push(entry);
    const overflow = keep.length - HISTORY_MAX_ENTRIES;
    const entries = overflow > 0 ? keep.slice(overflow) : keep;
    return { entries, pointer: entries.length - 1 };
  });
}

/**
 * 消费导航意图（防误记，决议 8）：记录 effect 在入史前调用——匹配当前
 * suppress 则吸收（返回 true，调用侧不再 record）；不匹配（目标被删跳过
 * 后用户去了别处）也一并过期清除，返回 false，画面正常入史。
 */
export function consumeSuppress(entry: TerminalHistoryEntry | null): boolean {
  const { suppress } = useTerminalHistoryStore.getState();
  if (!suppress || !entry || !sameEntry(suppress, entry)) {
    if (suppress) useTerminalHistoryStore.setState({ suppress: null });
    return false;
  }
  useTerminalHistoryStore.setState({ suppress: null });
  return true;
}

/** 读取当前导航意图（测试/诊断用）。 */
export function peekSuppress(): TerminalHistoryEntry | null {
  return useTerminalHistoryStore.getState().suppress;
}

/** 沿方向找下一个活条目并移指针。exists 缺省全部视为存在。 */
function step(
  direction: -1 | 1,
  exists?: (entry: TerminalHistoryEntry) => boolean,
): TerminalHistoryEntry | null {
  const state = useTerminalHistoryStore.getState();
  const { entries } = state;
  let pointer = state.pointer;
  while (true) {
    const next = pointer + direction;
    if (next < 0 || next >= entries.length) return null;
    const candidate = entries[next];
    pointer = next;
    if (!exists || exists(candidate)) {
      useTerminalHistoryStore.setState({ pointer, suppress: candidate });
      return candidate;
    }
    // 死链：跳过继续找（决议 4）
  }
}

/**
 * 后退一步：移指针 + 置 suppress 并返回目标条目（不执行导航——执行由
 * AiCodingApp 的快捷键 effect 走 enterProjectFromKanban / 同项目快速路径）。
 * exists 用于跳过已删 (project, task)。
 */
export function stepBack(exists?: (entry: TerminalHistoryEntry) => boolean): TerminalHistoryEntry | null {
  return step(-1, exists);
}

/** 前进一步，语义同 stepBack。 */
export function stepForward(
  exists?: (entry: TerminalHistoryEntry) => boolean,
): TerminalHistoryEntry | null {
  return step(1, exists);
}

export function canBack(): boolean {
  return useTerminalHistoryStore.getState().pointer > 0;
}

export function canForward(): boolean {
  const { entries, pointer } = useTerminalHistoryStore.getState();
  return pointer >= 0 && pointer < entries.length - 1;
}
