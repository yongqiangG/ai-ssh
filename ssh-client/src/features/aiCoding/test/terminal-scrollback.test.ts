import { describe, expect, it } from "vitest";
import {
  clampTerminalScrollback,
  DEFAULT_TERMINAL_SCROLLBACK,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN,
} from "../types";

// 决议见 vault 需求-终端滚动缓冲对齐WT.md:
// 默认 9000 对齐 WT historySize 9001(步进取整),MAX 20000。

describe("clampTerminalScrollback", () => {
  it("defaults to WT-aligned 9000", () => {
    expect(DEFAULT_TERMINAL_SCROLLBACK).toBe(9000);
    expect(clampTerminalScrollback(undefined)).toBe(9000);
    expect(clampTerminalScrollback("not-a-number")).toBe(9000);
    expect(clampTerminalScrollback(Number.NaN)).toBe(9000);
  });

  it("clamps to [500, 20000]", () => {
    expect(TERMINAL_SCROLLBACK_MIN).toBe(500);
    expect(TERMINAL_SCROLLBACK_MAX).toBe(20000);
    expect(clampTerminalScrollback(0)).toBe(500);
    expect(clampTerminalScrollback(300)).toBe(500);
    expect(clampTerminalScrollback(100000)).toBe(20000);
  });

  it("snaps to step 500", () => {
    expect(clampTerminalScrollback(9001)).toBe(9000);
    expect(clampTerminalScrollback(1249)).toBe(1000);
    expect(clampTerminalScrollback(1250)).toBe(1500);
    expect(clampTerminalScrollback(12345)).toBe(12500);
  });

  it("keeps explicit legacy values that differ from old default", () => {
    // 迁移语义(Rust 侧)只迁移 ==1000;前端 clamp 不做迁移,只保证域内
    expect(clampTerminalScrollback(1000)).toBe(1000);
    expect(clampTerminalScrollback(2000)).toBe(2000);
    expect(clampTerminalScrollback(5000)).toBe(5000);
  });
});
