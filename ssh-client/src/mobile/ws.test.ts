import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWs, type WsConnState } from "./ws";

// 浏览器 WebSocket 的可控行为替身：手动触发 onopen/onmessage/onclose
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // 测试驱动钩子
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

describe("TaskWs", () => {
  let states: WsConnState[];
  let snapshots: string[];
  let snapshotAlts: boolean[];
  let outputs: string[];
  let statuses: string[];

  const makeWs = () =>
    new TaskWs(
      "ws://x/api/ws/task/t1?token=k",
      {
        onSnapshot: (d, alt) => {
          snapshots.push(d);
          snapshotAlts.push(alt);
        },
        onOutput: (d) => outputs.push(d),
        onStatus: (s) => statuses.push(s),
        onConnState: (s) => states.push(s),
      },
      () => new FakeWebSocket() as unknown as WebSocket,
    );

  beforeEach(() => {
    FakeWebSocket.instances = [];
    states = [];
    snapshots = [];
    snapshotAlts = [];
    outputs = [];
    statuses = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches snapshot/output/status messages", () => {
    const ws = makeWs();
    ws.start();
    const sock = lastSocket();
    sock.open();
    sock.message({ type: "snapshot", data: "history...", alt: true });
    sock.message({ type: "snapshot", data: "raw tail", alt: false });
    sock.message({ type: "output", data: "new line" });
    sock.message({ type: "status", task_id: "t1", status: "input_required" });
    sock.message({ type: "garbage", x: 1 });
    expect(snapshots).toEqual(["history...", "raw tail"]);
    // 终端模式标志随快照透传（260824 terminal-ux 双模式交互的判据）
    expect(snapshotAlts).toEqual([true, false]);
    expect(outputs).toEqual(["new line"]);
    expect(statuses).toEqual(["input_required"]);
    ws.close();
  });

  it("sends input frames only when open", () => {
    const ws = makeWs();
    ws.start();
    ws.sendInput("y\n"); // 未连接：丢弃
    expect(lastSocket().sent).toEqual([]);
    lastSocket().open();
    ws.sendInput("y\n");
    expect(JSON.parse(lastSocket().sent[0])).toEqual({ type: "input", data: "y\n" });
    ws.close();
  });

  it("reconnects with escalating backoff after drops", () => {
    const ws = makeWs();
    ws.start();
    // 第一次掉线：1s 后重连
    lastSocket().drop();
    expect(states).toContain("backoff");
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // 再掉：2s
    lastSocket().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    ws.close();
  });

  it("resets backoff after a stable 30s connection", () => {
    const ws = makeWs();
    ws.start();
    lastSocket().open();
    vi.advanceTimersByTime(30_000); // 稳定窗到，退避归零
    lastSocket().drop();
    vi.advanceTimersByTime(1000); // 下一档应为 1s 而非 5s
    expect(FakeWebSocket.instances).toHaveLength(2);
    ws.close();
  });

  it("manual close stops reconnection", () => {
    const ws = makeWs();
    ws.start();
    lastSocket().open();
    ws.close();
    expect(states[states.length - 1]).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
