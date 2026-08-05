import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "./layoutStore";

beforeEach(() => {
  useLayoutStore.setState({
    activeSidebarView: "servers",
    centerView: "terminal",
    showSidebar: true,
    showAiPanel: true,
  });
});

describe("layoutStore local development view", () => {
  it("supports local as an independent sidebar and center view", () => {
    useLayoutStore.getState().setActiveSidebarView("local");
    useLayoutStore.getState().setCenterView("local");

    expect(useLayoutStore.getState().activeSidebarView).toBe("local");
    expect(useLayoutStore.getState().centerView).toBe("local");
  });

  it("keeps the AI panel preference for restoring it after leaving local view", () => {
    useLayoutStore.getState().setCenterView("local");
    expect(useLayoutStore.getState().showAiPanel).toBe(true);

    useLayoutStore.getState().setCenterView("terminal");
    expect(useLayoutStore.getState().showAiPanel).toBe(true);
  });
});
