import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CursorMascot } from "../components/CursorMascot";
import styles from "../components/CursorMascot.module.css";

// 小橙蟹(260819 统一吉祥物):行为全在 CSS 动画里,这里测 props →
// class/样式的正确落点,保证 variant/state 编排不回归。

describe("CursorMascot", () => {
  it("默认渲染 idle 变体:bob + 眨眼 + 双钳轻摆,装饰性对无障碍隐藏", () => {
    const { container } = render(<CursorMascot />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBeNull(); // 尺寸走 style,不走属性
    expect(svg?.style.width).toBe("112px");
    expect(svg?.querySelector(`g.${styles.bob}`)).toBeTruthy();
    expect(svg?.querySelectorAll(`ellipse.${styles.eye}`).length).toBe(2);
    expect(svg?.querySelector(`g.${styles.clawR}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.clawRWave}`)).toBeNull();
    expect(svg?.querySelector(`g.${styles.walkA}`)).toBeNull();
    // 腿:两边各两条,共四条
    expect(svg?.querySelectorAll(`path.${styles.leg}`).length).toBe(4);
  });

  it("wave 变体:碎步 + 挥钳 + 眼柄道别编排,不 bob", () => {
    const { container } = render(<CursorMascot size={40} variant="wave" />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelector(`g.${styles.walkA}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.walkB}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.clawRWave}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.eyesWave}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.bob}`)).toBeNull();
    expect(svg?.style.width).toBe("40px");
  });

  it("state=eager:眼睛放大 + 身体前倾(彩蛋:输入框有内容)", () => {
    const { container } = render(<CursorMascot state="eager" />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelector(`g.${styles.eyesEager}`)).toBeTruthy();
    expect(svg?.querySelector(`.${styles.leanEager}`)).toBeTruthy();
    expect(svg?.querySelector(`.${styles.leanReacting}`)).toBeNull();
  });

  it("state=reacting:一次性弹跳 + 眯眼(切 agent 的瞬时反馈)", () => {
    const { container } = render(<CursorMascot state="reacting" />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelector(`.${styles.leanReacting}`)).toBeTruthy();
    expect(svg?.querySelector(`g.${styles.eyesReacting}`)).toBeTruthy();
  });

  it("透传 className 与 style(rail 探头位移由外层编排)", () => {
    const { container } = render(
      <CursorMascot variant="wave" className="rail-mascot-wave" style={{ left: 14 }} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("rail-mascot-wave")).toBe(true);
    expect(svg?.classList.contains(styles.root)).toBe(true);
    expect(svg?.style.left).toBe("14px");
  });
});
