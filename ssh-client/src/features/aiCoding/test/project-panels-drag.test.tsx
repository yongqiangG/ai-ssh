import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useProjectPanels } from "../hooks/useProjectPanels";

// 拖拽改宽/改高的兜底行为（260820 评审 P3-c）：
// pointerup / pointercancel / window blur / 卸载 四路都能终止拖拽并还原
// body 光标；窗外释放后回窗（buttons=0 的 pointermove）也能终止。
// 旧实现只挂 mousemove/mouseup 且无卸载兜底——拖出窗外释放或拖拽中卸载时，
// document 级监听连同 setState 闭包悬挂到下一次任意 mouseup。

function Probe() {
  const { handleRightResizeStart, rightPanelWidth } = useProjectPanels();
  return (
    <div
      data-testid="handle"
      onMouseDown={handleRightResizeStart}
      data-width={rightPanelWidth}
    />
  );
}

function startDrag() {
  fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 400, clientY: 0, buttons: 1 });
}

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useProjectPanels 拖拽兜底", () => {
  it("pointerup 终止拖拽并还原 body 样式", () => {
    render(<Probe />);
    startDrag();
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    act(() => {
      fireEvent.pointerMove(document, { clientX: 350, buttons: 1 });
    });
    expect(screen.getByTestId("handle").dataset.width).toBe("330"); // 280 + (400-350)

    act(() => {
      fireEvent.pointerUp(document);
    });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // 终止后再 move 不再改宽度
    act(() => {
      fireEvent.pointerMove(document, { clientX: 100, buttons: 1 });
    });
    expect(screen.getByTestId("handle").dataset.width).toBe("330");
  });

  it("pointercancel 终止拖拽", () => {
    render(<Probe />);
    startDrag();
    act(() => {
      fireEvent.pointerCancel(document);
    });
    expect(document.body.style.cursor).toBe("");
    act(() => {
      fireEvent.pointerMove(document, { clientX: 100, buttons: 1 });
    });
    expect(screen.getByTestId("handle").dataset.width).toBe("280");
  });

  it("window blur 终止拖拽（窗外切走）", () => {
    render(<Probe />);
    startDrag();
    act(() => {
      fireEvent(window, new Event("blur"));
    });
    expect(document.body.style.cursor).toBe("");
  });

  it("窗外释放后回窗：buttons=0 的首个 pointermove 终止拖拽", () => {
    render(<Probe />);
    startDrag();
    act(() => {
      // 指针回到窗口，但按键已不在按下状态
      fireEvent.pointerMove(document, { clientX: 300, buttons: 0 });
    });
    expect(document.body.style.cursor).toBe("");
    // 后续带按键的 move 也不再生效
    act(() => {
      fireEvent.pointerMove(document, { clientX: 100, buttons: 1 });
    });
    expect(screen.getByTestId("handle").dataset.width).toBe("280");
  });

  it("拖拽中卸载：unmount 兜底终止并还原样式", () => {
    const { unmount } = render(<Probe />);
    startDrag();
    expect(document.body.style.cursor).toBe("col-resize");
    act(() => {
      unmount();
    });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    // 卸载后 move 不再触发 setState（也不会有 React 警告）
    act(() => {
      fireEvent.pointerMove(document, { clientX: 100, buttons: 1 });
    });
  });
});
