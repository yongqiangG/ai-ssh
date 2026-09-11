import { beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_MAX_ENTRIES,
  stepBack,
  stepForward,
  recordTerminalView,
  consumeSuppress,
  peekSuppress,
  canBack,
  canForward,
  useTerminalHistoryStore,
  type TerminalHistoryEntry,
} from "../terminalHistory";

function entry(projectId: string, taskId: string): TerminalHistoryEntry {
  return { projectId, taskId };
}

// zustand 模块级状态，用例间重置避免相互污染（attention.test.ts 同模式）
beforeEach(() => {
  useTerminalHistoryStore.setState({
    entries: [],
    pointer: -1,
    suppress: null,
  });
});

describe("recordTerminalView 入史规则", () => {
  it("空历史 append，指针指向新条目", () => {
    recordTerminalView(entry("p1", "a"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a")]);
    expect(s.pointer).toBe(0);
  });

  it("与指针当前条目相同（同项目同任务）→ 去重不 append", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "a"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toHaveLength(1);
    expect(s.pointer).toBe(0);
  });

  it("指针在末尾时 append 新条目", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a"), entry("p1", "b")]);
    expect(s.pointer).toBe(1);
  });

  it("指针不在末尾时（后退过）append 截断前向尾巴（浏览器模型）", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    recordTerminalView(entry("p1", "c"));
    stepBack(); // 指针 c→b
    recordTerminalView(entry("p1", "d"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a"), entry("p1", "b"), entry("p1", "d")]);
    expect(s.pointer).toBe(2);
  });

  it("同任务不同项目 → 不同条目（项目+任务二元组判等）", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p2", "a"));
    expect(useTerminalHistoryStore.getState().entries).toHaveLength(2);
  });

  it("上限 50：溢出丢最老，指针同步前移", () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) {
      recordTerminalView(entry("p1", `t${i}`));
    }
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toHaveLength(HISTORY_MAX_ENTRIES);
    // 最老的 5 条被丢，头部是 t5
    expect(s.entries[0]).toEqual(entry("p1", "t5"));
    expect(s.pointer).toBe(HISTORY_MAX_ENTRIES - 1);
  });

  it("null（离开终端画面）不入史也不清史", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(null);
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a")]);
    expect(s.pointer).toBe(0);
  });
});

describe("stepBack / stepForward 指针移动", () => {
  it("指针在头部时 stepBack 返回 null 且不动史", () => {
    recordTerminalView(entry("p1", "a"));
    expect(stepBack()).toBeNull();
    expect(useTerminalHistoryStore.getState().pointer).toBe(0);
  });

  it("空历史 stepBack/stepForward 均返回 null", () => {
    expect(stepBack()).toBeNull();
    expect(stepForward()).toBeNull();
  });

  it("stepBack 返回目标条目并移指针 + 置 suppress", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p2", "b"));
    const target = stepBack();
    const s = useTerminalHistoryStore.getState();
    expect(target).toEqual(entry("p1", "a"));
    expect(s.pointer).toBe(0);
    expect(peekSuppress()).toEqual(entry("p1", "a"));
  });

  it("指针在末尾时 stepForward 返回 null", () => {
    recordTerminalView(entry("p1", "a"));
    expect(stepForward()).toBeNull();
  });

  it("stepBack 后 stepForward 回到原条目", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    stepBack();
    expect(stepForward()).toEqual(entry("p1", "b"));
    expect(useTerminalHistoryStore.getState().pointer).toBe(1);
  });

  it("带 exists 校验：跳过死链继续找（决议 4）", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "dead"));
    recordTerminalView(entry("p2", "c"));
    // 当前在 c，后退：dead 已删 → 跳过 → 直达 a
    const target = stepBack((e) => !(e.taskId === "dead"));
    const s = useTerminalHistoryStore.getState();
    expect(target).toEqual(entry("p1", "a"));
    expect(s.pointer).toBe(0);
  });

  it("带 exists 校验：全部是死链 → 返回 null，指针不动", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    const target = stepBack(() => false);
    expect(target).toBeNull();
    expect(useTerminalHistoryStore.getState().pointer).toBe(1);
  });

  it("死链跳过的 stepForward：跳过中间死链到末尾活条目", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "dead"));
    recordTerminalView(entry("p1", "c"));
    stepBack();
    stepBack(); // 指针 0（跳过 dead 直达 a）
    const target = stepForward((e) => e.taskId !== "dead");
    expect(target).toEqual(entry("p1", "c"));
    expect(useTerminalHistoryStore.getState().pointer).toBe(2);
  });
});

describe("suppress 防误记（决议 8）", () => {
  it("导航到目标后记录 effect 携带同条目 → consumeSuppress 返回 true 且不 append", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    stepBack(); // suppress = a
    // 画面切到 a，记录 effect 尝试入史（同条目去重本就不 append，但语义上
    // 由 consume 吸收；这里验证 suppress 被消费）
    const consumed = consumeSuppress(entry("p1", "a"));
    expect(consumed).toBe(true);
    expect(peekSuppress()).toBeNull();
    // 再手动看 c：无 suppress，正常入史
    recordTerminalView(entry("p1", "c"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a"), entry("p1", "c")]);
    expect(s.pointer).toBe(1);
  });

  it("suppress 未匹配（目标被删跳过后用户去了别处）→ consume 返回 false 并过期清除", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    stepBack(); // suppress = a
    // a 已删，导航跳过没执行；用户手动去了 d —— d 不匹配 suppress
    expect(consumeSuppress(entry("p1", "d"))).toBe(false);
    expect(peekSuppress()).toBeNull();
  });

  it("无 suppress 时 consume 返回 false", () => {
    expect(consumeSuppress(entry("p1", "a"))).toBe(false);
  });

  it("无 suppress 时手动回到指针前一条目（= 手动前进）→ 正常截断入史", () => {
    recordTerminalView(entry("p1", "a"));
    recordTerminalView(entry("p1", "b"));
    stepBack(); // 指针 0
    stepForward(); // 指针 1（suppress b）
    consumeSuppress(entry("p1", "b"));
    stepBack(); // 指针 0（suppress a）
    consumeSuppress(entry("p1", "a"));
    // 无 suppress，手动点 b：截断后 append（浏览器：手动重开前向条目 = 新路径）
    recordTerminalView(entry("p1", "b"));
    const s = useTerminalHistoryStore.getState();
    expect(s.entries).toEqual([entry("p1", "a"), entry("p1", "b")]);
    expect(s.pointer).toBe(1);
  });
});

describe("canBack / canForward", () => {
  it("空历史 / 单条 / 指针末尾", () => {
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(false);
    recordTerminalView(entry("p1", "a"));
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(false);
    recordTerminalView(entry("p1", "b"));
    expect(canBack()).toBe(true);
    expect(canForward()).toBe(false);
    stepBack();
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(true);
  });
});
