/**
 * 终端实例管理器（非 React 的普通单例模块）。
 *
 * ## 为什么不放进 React 组件或 zustand store？
 * 类比后端：这里相当于一个有状态的 Manager Bean，持有的都是「资源型」对象——
 * xterm Terminal 实例（内部有 canvas 渲染层）、轮询定时器、ResizeObserver。
 * React 组件的 state 和 zustand store 适合存「可渲染的快照数据」（随时可整体替换），
 * 不适合存这类需要显式生命周期管理（创建/销毁/停定时器）的资源：
 * 组件卸载会丢弃 state，而我们要求「切换 tab 甚至关闭面板后终端日志仍保留」。
 * 因此：本模块管资源与副作用，zustand（terminalStore）只存 UI 需要的轻量状态
 * （tab 列表、激活项、断连标记），两者通过回调（setOnSessionClosed）单向通知。
 *
 * ## 每个连接一个 ManagedTerminal，关键机制：
 * - 输入合批：xterm 的 onData 每个按键触发一次，直接发请求会打爆后端；
 *   先积累进 inputBuf，10ms 定时器到点一次性 POST（对手速无感知）。
 * - 输出轮询：每 50ms GET read 拉增量输出写入 xterm；上一次请求未返回时跳过本轮
 *   （inFlight 标志），避免网络慢时请求堆叠。
 * - 断连判定：连续 3 次轮询失败，或后端返回 closed=true（后端断联标记），
 *   即停止轮询、终端里打印红色提示，并回调通知 UI 层更新状态。
 * - resize 去重：只有 cols/rows 与上次成功发送值不同才调后端，
 *   拖拽分栏时 ResizeObserver 高频触发也不会产生重复请求。
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  closeTerminal,
  openTerminal,
  readTerminal,
  resizeTerminal,
  writeTerminal,
} from "../api/terminal";

/** 输出轮询间隔 */
const POLL_INTERVAL_MS = 50;
/** 键入合批窗口：10ms 内的按键合并为一次写请求 */
const INPUT_FLUSH_MS = 10;
/** 连续轮询失败该次数即判定断连 */
const MAX_POLL_ERRORS = 3;

/** 单个连接的终端运行时上下文（资源 + 轮询状态） */
interface ManagedTerminal {
  term: Terminal;
  fitAddon: FitAddon;
  /** 后端会话 id；open 请求返回前为 null */
  sessionId: string | null;
  /** 输出轮询定时器 id（浏览器环境 setInterval 返回 number） */
  pollTimer: number | null;
  /** 上一轮 read 请求是否仍在途（防堆叠） */
  pollInFlight: boolean;
  /** 连续轮询失败计数（成功一次即清零） */
  pollErrors: number;
  /** 键入合批缓冲 */
  inputBuf: string;
  inputTimer: number | null;
  /** 上次成功上报的 pty 尺寸（resize 去重用） */
  lastCols: number;
  lastRows: number;
  resizeObserver: ResizeObserver | null;
  /** false = 已断连/已释放，一切读写与定时器动作短路 */
  alive: boolean;
}

/** connectionId -> 终端上下文。模块级 Map，跨组件卸载存活 */
const terminals = new Map<string, ManagedTerminal>();

/**
 * 正在执行 open 流程的连接集合。
 * React 18 StrictMode 在开发模式下会把 effect 执行两遍（mount→unmount→mount，
 * 用于暴露副作用问题），不防重会向后端开两个会话；第二次调用在此同步短路。
 */
const opening = new Set<string>();

/** 断连通知：UI 层（TerminalPanel）注册，用于更新 store 里的 tab/连接状态 */
type SessionClosedListener = (connectionId: string) => void;
let onSessionClosed: SessionClosedListener | null = null;

export function setOnSessionClosed(listener: SessionClosedListener | null): void {
  onSessionClosed = listener;
}

/**
 * 按 connectionId 取该终端的后端 sessionId（open 请求返回后才有，未 open 完成为 null）。
 * 供 chatStore.sendMessage 带上 terminalSessionId（让 AI 工具定位活跃终端）。
 */
export function getTerminalSessionId(connectionId: string): string | null {
  return terminals.get(connectionId)?.sessionId ?? null;
}

/** 该连接是否已有终端实例（含已断连但日志仍保留的） */
export function hasTerminal(connectionId: string): boolean {
  return terminals.has(connectionId);
}

/** 该连接的终端是否仍在活跃会话中 */
export function isTerminalAlive(connectionId: string): boolean {
  return terminals.get(connectionId)?.alive ?? false;
}

/** 从当前 CSS 变量读取 xterm 主题色（值随 html[data-theme] 切换） */
function readXtermTheme() {
  const css = getComputedStyle(document.documentElement);
  return {
    background: css.getPropertyValue("--terminal-bg").trim() || "#0a0b10",
    foreground: css.getPropertyValue("--vsc-fg").trim() || "#c8cad4",
  };
}

/**
 * 把当前主题色应用到所有已存在的终端实例。
 * xterm 的 theme 是创建时快照，CSS 变量后续变化不会自动生效；
 * UI 层在主题切换时调用本函数完成同步（见 TerminalPanel）。
 */
export function applyTerminalTheme(): void {
  const theme = readXtermTheme();
  for (const mt of terminals.values()) {
    mt.term.options.theme = theme;
  }
}

/**
 * 在给定容器里创建 xterm 实例并打开后端会话（新开与断连后重开共用入口）。
 *
 * 流程：防重检查 → 丢弃旧实例（若有）→ 创建 Terminal 并挂到 DOM → 绑定
 * 输入/resize 监听 → 调后端 open（阻塞至初始输出就绪）→ 写入初始输出 → 启动轮询。
 *
 * @throws open 接口失败时向上抛出（调用方据此更新 tab 状态），
 *         错误信息同时已写入终端可见区域
 */
export async function openTerminalIn(
  connectionId: string,
  container: HTMLElement
): Promise<void> {
  if (opening.has(connectionId)) return;
  opening.add(connectionId);
  try {
    // 断连后重开：旧实例的会话已失效、日志无法延续，直接丢弃重建
    disposeTerminal(connectionId);

    // xterm 的 theme 只接受具体色值，从 CSS 变量读取当前主题；
    // 之后的主题切换由 applyTerminalTheme() 统一同步
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      scrollback: 5000,
      theme: readXtermTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    // 按容器实际尺寸计算 cols/rows（容器必须已在文档流中且可见）
    fitAddon.fit();

    const mt: ManagedTerminal = {
      term,
      fitAddon,
      sessionId: null,
      pollTimer: null,
      pollInFlight: false,
      pollErrors: 0,
      inputBuf: "",
      inputTimer: null,
      lastCols: term.cols,
      lastRows: term.rows,
      resizeObserver: null,
      alive: true,
    };
    terminals.set(connectionId, mt);

    // 用户键入：只进缓冲，10ms 后合批发送（见 flushInput）
    term.onData((data) => {
      if (!mt.alive) return;
      mt.inputBuf += data;
      if (mt.inputTimer === null) {
        mt.inputTimer = window.setTimeout(() => flushInput(mt), INPUT_FLUSH_MS);
      }
    });

    // xterm 尺寸变化（fit 计算出新 cols/rows 时触发）：与缓存比对去重后上报后端
    term.onResize(({ cols, rows }) => {
      if (!mt.alive || !mt.sessionId) return;
      if (cols === mt.lastCols && rows === mt.lastRows) return;
      mt.lastCols = cols;
      mt.lastRows = rows;
      resizeTerminal(mt.sessionId, cols, rows).catch(() => {
        // 尺寸同步失败不影响使用；真正断连由轮询判定
      });
    });

    // 容器几何尺寸变化（拖拽分栏、窗口缩放）→ 重新 fit。
    // 容器用 visibility:hidden 切换（而非 display:none）正是为了这里：
    // hidden 不改变布局，clientWidth/Height 仍是真实值，fit 不会算出 0
    observeContainer(mt, container);

    // 打开后端会话；服务端等 motd+提示符积累完才返回，写入即完整首屏
    const { sessionId, output } = await openTerminal(
      connectionId,
      term.cols,
      term.rows
    );
    mt.sessionId = sessionId;
    mt.lastCols = term.cols;
    mt.lastRows = term.rows;
    if (output) term.write(output);

    // 启动输出轮询
    mt.pollTimer = window.setInterval(
      () => void poll(connectionId, mt),
      POLL_INTERVAL_MS
    );
    term.focus();
  } catch (e) {
    const mt = terminals.get(connectionId);
    if (mt) {
      const msg = e instanceof Error ? e.message : String(e);
      mt.term.write(`\r\n\x1b[31m终端打开失败：${msg}\x1b[0m\r\n`);
      markDead(connectionId, mt);
    }
    throw e;
  } finally {
    opening.delete(connectionId);
  }
}

/** 合批窗口到期：一次性把缓冲的按键发给后端 */
function flushInput(mt: ManagedTerminal): void {
  mt.inputTimer = null;
  const data = mt.inputBuf;
  mt.inputBuf = "";
  if (!data || !mt.alive || !mt.sessionId) return;
  writeTerminal(mt.sessionId, data).catch(() => {
    // 写失败通常意味着会话已断，统一交给轮询错误计数判定，不在此重复处理
  });
}

/** （重新）观察容器尺寸变化；attach 到新容器时旧 observer 一并替换 */
function observeContainer(mt: ManagedTerminal, container: HTMLElement): void {
  mt.resizeObserver?.disconnect();
  mt.resizeObserver = new ResizeObserver(() => {
    if (mt.alive && container.clientWidth > 0 && container.clientHeight > 0) {
      mt.fitAddon.fit();
    }
  });
  mt.resizeObserver.observe(container);
}

/**
 * 把已存在的终端 DOM 挂回新容器。
 *
 * 场景：顶栏「隐藏终端」会卸载整个 TerminalPanel（React 移除所有容器 div），
 * 再显示时组件重新挂载、拿到的是**新的** div，而 xterm 实例（连同它的渲染 DOM
 * term.element）仍完好地留在 manager 里。xterm 的 open() 只能调用一次，
 * 但它创建的根节点可以整体搬家——appendChild 移动现有 DOM 节点，日志随之保留。
 */
export function attachTerminal(connectionId: string, container: HTMLElement): void {
  const mt = terminals.get(connectionId);
  const el = mt?.term.element;
  if (!mt || !el) return;
  if (el.parentElement === container) return; // 已在目标容器里，无事可做
  container.appendChild(el);
  // 隐藏期间主题可能已切换，重挂时按当前 CSS 变量补一次同步
  mt.term.options.theme = readXtermTheme();
  observeContainer(mt, container);
  if (mt.alive) mt.fitAddon.fit();
}

/** 单轮输出拉取：增量写入 xterm；断连判定（closed 标记 / 连续失败计数）也在这里 */
async function poll(connectionId: string, mt: ManagedTerminal): Promise<void> {
  if (!mt.alive || !mt.sessionId || mt.pollInFlight) return;
  mt.pollInFlight = true;
  try {
    const { content, closed } = await readTerminal(mt.sessionId);
    mt.pollErrors = 0;
    if (content) mt.term.write(content);
    if (closed) handleDisconnected(connectionId, mt);
  } catch {
    mt.pollErrors += 1;
    if (mt.pollErrors >= MAX_POLL_ERRORS) {
      handleDisconnected(connectionId, mt);
    }
  } finally {
    mt.pollInFlight = false;
  }
}

/** 断连收尾：终端里打印提示 → 停轮询 → 通知 UI 层。日志与实例保留供查看 */
function handleDisconnected(connectionId: string, mt: ManagedTerminal): void {
  if (!mt.alive) return;
  mt.term.write("\r\n\x1b[31m[连接已断开]\x1b[0m\r\n");
  markDead(connectionId, mt);
}

/** 心跳（10s 连接状态检查）发现连接失效时由 UI 层调用，走同一断连收尾 */
export function markDisconnected(connectionId: string): void {
  const mt = terminals.get(connectionId);
  if (mt && mt.alive) {
    handleDisconnected(connectionId, mt);
  }
}

function markDead(connectionId: string, mt: ManagedTerminal): void {
  mt.alive = false;
  stopTimers(mt);
  onSessionClosed?.(connectionId);
}

/** 切换 tab 后调用：让键盘输入立即生效，无需先点击终端区域 */
export function focusTerminal(connectionId: string): void {
  terminals.get(connectionId)?.term.focus();
}

/** 显式触发一次尺寸自适应（tab 切换回可见时容器尺寸可能已变化） */
export function fitTerminal(connectionId: string): void {
  const mt = terminals.get(connectionId);
  if (mt?.alive) mt.fitAddon.fit();
}

/**
 * 用户关闭 tab：先本地释放（立即生效），再尽力通知后端关闭会话。
 * 后端 close 幂等，失败也无妨——服务端还有「open 时清理同连接旧会话」兜底。
 */
export async function closeTerminalFor(connectionId: string): Promise<void> {
  const mt = terminals.get(connectionId);
  if (!mt) return;
  const sessionId = mt.sessionId;
  disposeTerminal(connectionId);
  if (sessionId) {
    try {
      await closeTerminal(sessionId);
    } catch {
      // 尽力而为
    }
  }
}

/** 本地资源释放：停定时器/观察器 → 销毁 xterm（移除 DOM 渲染层）→ 移出注册表 */
function disposeTerminal(connectionId: string): void {
  const mt = terminals.get(connectionId);
  if (!mt) return;
  mt.alive = false;
  stopTimers(mt);
  mt.resizeObserver?.disconnect();
  mt.term.dispose();
  terminals.delete(connectionId);
}

function stopTimers(mt: ManagedTerminal): void {
  if (mt.pollTimer !== null) {
    clearInterval(mt.pollTimer);
    mt.pollTimer = null;
  }
  if (mt.inputTimer !== null) {
    clearTimeout(mt.inputTimer);
    mt.inputTimer = null;
  }
}
