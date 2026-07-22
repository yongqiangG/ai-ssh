import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EXPECTED_BOOT_MS,
  estimateProgress,
  readExpectedBootMs,
  saveBootDuration,
} from "./bootProgress";

beforeEach(() => {
  localStorage.clear();
});

describe("estimateProgress", () => {
  it("elapsed=0 → 0", () => {
    expect(estimateProgress(0, 8000)).toBe(0);
  });

  it("负 elapsed 兜底为 0", () => {
    expect(estimateProgress(-100, 8000)).toBe(0);
  });

  it("单调不减", () => {
    let prev = 0;
    for (let t = 0; t <= 30000; t += 250) {
      const p = estimateProgress(t, 8000);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("elapsed 达到预估时长时进入 85%-90% 区间（悬停带）", () => {
    const p = estimateProgress(8000, 8000);
    expect(p).toBeGreaterThanOrEqual(0.85);
    expect(p).toBeLessThanOrEqual(0.9);
  });

  it("远超预估时长也封顶 90%，等待就绪冲刺", () => {
    expect(estimateProgress(120000, 8000)).toBe(0.9);
  });

  it("expectedMs 非法（0/负/NaN）时用默认预估，不除零", () => {
    expect(estimateProgress(4000, 0)).toBeGreaterThan(0);
    expect(estimateProgress(4000, -5)).toBeGreaterThan(0);
    expect(estimateProgress(4000, Number.NaN)).toBeGreaterThan(0);
    expect(estimateProgress(4000, 0)).toBe(
      estimateProgress(4000, DEFAULT_EXPECTED_BOOT_MS)
    );
  });
});

describe("readExpectedBootMs / saveBootDuration", () => {
  it("无历史记录 → 默认 8s", () => {
    expect(readExpectedBootMs()).toBe(DEFAULT_EXPECTED_BOOT_MS);
  });

  it("保存后读取到上次耗时", () => {
    saveBootDuration(5200);
    expect(readExpectedBootMs()).toBe(5200);
  });

  it("保存异常小值时按下限收敛（防抖动出瞬跳进度）", () => {
    saveBootDuration(10);
    expect(readExpectedBootMs()).toBeGreaterThanOrEqual(1500);
  });

  it("保存异常大值时按上限收敛", () => {
    saveBootDuration(10 * 60 * 1000);
    expect(readExpectedBootMs()).toBeLessThanOrEqual(60000);
  });

  it("localStorage 脏数据（非数字）→ 默认值", () => {
    localStorage.setItem("ai-ssh:lastBootMs", "not-a-number");
    expect(readExpectedBootMs()).toBe(DEFAULT_EXPECTED_BOOT_MS);
  });
});
