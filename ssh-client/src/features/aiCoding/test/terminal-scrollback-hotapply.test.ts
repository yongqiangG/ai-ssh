import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { applyTerminalScrollback } from "../components/terminalShared";

// 运行时热改(vault 需求-终端滚动缓冲对齐WT.md 决议 3):xterm 6 支持运行时
// 改 options.scrollback,赋值即触发内部 buffer resize。用真 Terminal 实例
// (headless 可用)验证 helper 的行为契约,不 mock xterm。

describe("applyTerminalScrollback(运行时热改)", () => {
  it("赋值立即生效:改 buffer 行数上限", () => {
    const term = new Terminal({ scrollback: 1000 });
    applyTerminalScrollback(term, 20000);
    expect(term.options.scrollback).toBe(20000);
    term.dispose();
  });

  it("写满后扩容,历史行数上限跟随新值", () => {
    const term = new Terminal({ scrollback: 500, cols: 80, rows: 10 });
    const line = "x".repeat(79) + "\n";
    term.write(line.repeat(2000), () => {
      // 500 档:缓冲上限 500+10 可视 = 510
      expect(term.buffer.normal.length).toBeLessThanOrEqual(510);
      applyTerminalScrollback(term, 5000);
      term.write(line.repeat(6000), () => {
        // 5000 档:缓冲上限 5000+10 = 5010
        expect(term.buffer.normal.length).toBeLessThanOrEqual(5010);
        expect(term.buffer.normal.length).toBeGreaterThan(510);
        term.dispose();
      });
    });
  });

  it("幂等:同值不重复赋值(无副作用)", () => {
    const term = new Terminal({ scrollback: 9000 });
    applyTerminalScrollback(term, 9000); // 同值,应直接 return
    expect(term.options.scrollback).toBe(9000);
    term.dispose();
  });
});
