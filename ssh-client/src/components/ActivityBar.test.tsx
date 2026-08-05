import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ActivityBar from "./ActivityBar";
import { useLayoutStore } from "../stores/layoutStore";

beforeEach(() => {
  useLayoutStore.setState({
    activeSidebarView: "servers",
    centerView: "terminal",
    showSidebar: true,
  });
});

describe("ActivityBar local development entry", () => {
  it("switches to the local center and sidebar views", () => {
    render(<ActivityBar />);

    fireEvent.click(screen.getByTitle("本地开发"));

    expect(useLayoutStore.getState().centerView).toBe("local");
    expect(useLayoutStore.getState().activeSidebarView).toBe("local");
    expect(screen.getByTitle("本地开发").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
