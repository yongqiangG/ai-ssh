import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingCodingNavigation,
  peekPendingCodingNavigation,
  setPendingCodingNavigation,
  subscribePendingCodingNavigation,
} from "../pendingNavigation";

// 模块级状态，用例间清空避免相互污染
beforeEach(() => {
  consumePendingCodingNavigation();
});

describe("pendingCodingNavigation 桥", () => {
  it("set 后 peek 可见且不清空，consume 取走后清空", () => {
    setPendingCodingNavigation({ taskId: "t1" });
    expect(peekPendingCodingNavigation()).toEqual({ taskId: "t1" });
    expect(peekPendingCodingNavigation()).toEqual({ taskId: "t1" });

    expect(consumePendingCodingNavigation()).toEqual({ taskId: "t1" });
    expect(peekPendingCodingNavigation()).toBeNull();
    expect(consumePendingCodingNavigation()).toBeNull();
  });

  it("set 时通知订阅者，退订后不再收到", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingCodingNavigation(listener);

    setPendingCodingNavigation({ taskId: "t2" });
    expect(listener).toHaveBeenCalledWith({ taskId: "t2" });

    unsubscribe();
    setPendingCodingNavigation({ taskId: "t3" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("订阅路径写入的积压仍可被消费（面板挂载中收到的点击不会丢失）", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingCodingNavigation(listener);
    setPendingCodingNavigation({ taskId: "t4" });
    unsubscribe();
    expect(consumePendingCodingNavigation()).toEqual({ taskId: "t4" });
  });
});
