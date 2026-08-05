import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "./projectStore";

const mockedOpen = vi.mocked(openDirectory);

beforeEach(() => {
  localStorage.clear();
  useProjectStore.persist.clearStorage();
  useProjectStore.setState({ projects: [], activeProjectPath: null });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectStore", () => {
  it("adds a project, selects it, and derives a readable name", async () => {
    const project = await useProjectStore
      .getState()
      .addProject("C:\\work\\ai-ssh\\");

    expect(project).toMatchObject({
      path: "C:\\work\\ai-ssh",
      name: "ai-ssh",
    });
    expect(useProjectStore.getState().activeProjectPath).toBe("C:\\work\\ai-ssh");
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it("uses the directory picker and promotes the selected project to recent", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);
    mockedOpen.mockResolvedValueOnce("D:\\project\\first");
    await useProjectStore.getState().addProject();
    mockedOpen.mockResolvedValueOnce("D:\\project\\second");
    await useProjectStore.getState().addProject();

    expect(mockedOpen).toHaveBeenCalledWith({ directory: true });
    expect(useProjectStore.getState().projects[0].path).toBe("D:\\project\\second");

    useProjectStore.getState().selectProject("D:\\project\\first");
    expect(useProjectStore.getState().activeProjectPath).toBe("D:\\project\\first");
    expect(useProjectStore.getState().projects[0].path).toBe("D:\\project\\first");
  });

  it("does not duplicate the same Windows path with different casing", async () => {
    await useProjectStore.getState().addProject("C:\\Work\\App");
    await useProjectStore.getState().addProject("c:\\work\\app\\");

    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().activeProjectPath).toBe("c:\\work\\app");
  });
});
