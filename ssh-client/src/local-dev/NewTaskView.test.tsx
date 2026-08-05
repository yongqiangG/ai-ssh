import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewTaskView, { toProjectRelativePath } from "./NewTaskView";

describe("NewTaskView project file references", () => {
  it("normalizes a file selected inside the project", () => {
    expect(
      toProjectRelativePath("C:\\work\\app", "C:\\work\\app\\src\\main.ts"),
    ).toBe("src/main.ts");
  });

  it("rejects paths outside the selected project", () => {
    expect(
      toProjectRelativePath("C:\\work\\app", "C:\\work\\app2\\secret.txt"),
    ).toBeNull();
  });

  it("submits the prompt, agent, and permission mode selected in the form", async () => {
    const onSubmit = vi.fn();
    render(<NewTaskView projectPath="C:\\work\\app" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText(/描述要完成的工作/), {
      target: { value: "repair the PTY" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "auto_edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /启动任务/ }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: "repair the PTY",
        agent: "codex",
        permissionMode: "auto_edit",
        fileRefs: [],
        images: [],
        texts: [],
      }),
    );
  });
});
