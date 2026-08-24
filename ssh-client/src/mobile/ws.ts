// 任务 WS 客户端：快照→实时流→状态事件 + 指数退避重连（阶段 2）。
// socketFactory 注入点供单测 mock；重连退避 1s/2s/5s/10s 封顶，
// 稳定连接 30s 后归零。

export type ServerMsg =
  // alt = 服务端仿真器探测的终端模式（260824 terminal-ux）：
  // true=alt 屏（Claude 型，历史在 TUI 内部，滚动走远程序列）；
  // false=普通屏（Codex 型，历史在终端 scrollback，滚动走本地 API）
  | { type: "snapshot"; data: string; alt: boolean }
  | { type: "output"; data: string }
  | { type: "status"; task_id: string; status: string | null };

export type WsConnState = "connecting" | "open" | "backoff" | "closed";

export interface TaskWsCallbacks {
  onSnapshot(data: string, alt: boolean): void;
  onOutput(data: string): void;
  onStatus(status: string): void;
  onConnState(state: WsConnState): void;
}

const BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000];
const STABLE_AFTER_MS = 30_000;

export class TaskWs {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private openedAt = 0;
  private manualClose = false;
  /** 最新终端尺寸；连接打开时自动（重）发——建连与重连后都需 resize。 */
  private pendingResize: { cols: number; rows: number } | null = null;

  constructor(
    private readonly url: string,
    private readonly cb: TaskWsCallbacks,
    private readonly socketFactory: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  start(): void {
    this.manualClose = false;
    this.connect();
  }

  private connect(): void {
    this.cb.onConnState(this.attempt === 0 ? "connecting" : "backoff");
    // nav=1 仅首连：服务端据此拽 PC 视图跟随（重连不重复导航）
    const url = this.attempt === 0 ? `${this.url}&nav=1` : this.url;
    const socket = this.socketFactory(url);
    this.socket = socket;
    socket.onopen = () => {
      this.openedAt = Date.now();
      this.cb.onConnState("open");
      // 重发最新尺寸（新建连/重连后 PTY 都需要 resize）
      if (this.pendingResize) {
        const { cols, rows } = this.pendingResize;
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      // 稳定满 30s 视为一次全新连接，退避归零
      this.stableTimer = setTimeout(() => {
        this.attempt = 0;
      }, STABLE_AFTER_MS);
    };
    socket.onmessage = (ev: MessageEvent) => this.handleMessage(String(ev.data));
    socket.onclose = () => {
      this.clearTimers();
      this.socket = null;
      if (this.manualClose) {
        this.cb.onConnState("closed");
        return;
      }
      // 连接从未 open 过或不足稳定窗 → 退避重连
      const wasStable = this.openedAt > 0 && Date.now() - this.openedAt >= STABLE_AFTER_MS;
      if (!wasStable) {
        this.attempt += 1;
      }
      const delay = BACKOFF_STEPS_MS[Math.min(this.attempt - 1, BACKOFF_STEPS_MS.length - 1)];
      this.cb.onConnState("backoff");
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
    // onerror 不单独处理：浏览器 WS 出错必然伴随 close，统一走重连
    socket.onerror = () => {};
  }

  private handleMessage(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case "snapshot":
        this.cb.onSnapshot(msg.data, msg.alt);
        break;
      case "output":
        this.cb.onOutput(msg.data);
        break;
      case "status":
        if (msg.status != null) this.cb.onStatus(msg.status);
        break;
    }
  }

  sendInput(data: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "input", data }));
    }
  }

  sendResize(cols: number, rows: number): void {
    this.pendingResize = { cols, rows };
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }

  private clearTimers(): void {
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    if (this.stableTimer != null) clearTimeout(this.stableTimer);
    this.retryTimer = null;
    this.stableTimer = null;
  }

  close(): void {
    this.manualClose = true;
    this.clearTimers();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.cb.onConnState("closed");
  }
}
