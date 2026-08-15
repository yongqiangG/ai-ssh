import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectListItem } from "../components/welcome/ProjectListItem";
import { I18nProvider } from "../i18n";
import type { ProjectRenameResult } from "../projectName";

const project = {
  id: "project-1",
  name: "Client App",
  path: "/workspace/client-app",
  lastOpenedAt: 1,
};

type RenameHandler = (name: string) => ProjectRenameResult | Promise<ProjectRenameResult>;

function renderItem(
  onRename: RenameHandler = vi.fn((): ProjectRenameResult => ({ ok: true, name: "Client Web" })),
) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onToggleHidden = vi.fn();
  render(
    <I18nProvider>
      <ProjectListItem
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onToggleHidden={onToggleHidden}
        onRename={onRename}
      />
    </I18nProvider>,
  );
  return { onOpen, onDelete, onToggleHidden, onRename };
}

describe("ProjectListItem", () => {
  it("opens rename without opening the project and submits the typed name", async () => {
    const { onOpen, onRename } = renderItem();

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    expect(onOpen).not.toHaveBeenCalled();

    const input = screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Client Web  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save project name" }));

    expect(onRename).toHaveBeenCalledWith("  Client Web  ");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull(),
    );
  });

  it("keeps editing and presents validation errors", async () => {
    const onRename = vi.fn(() => ({
      ok: false as const,
      error: "reserved_separator" as const,
    }));
    renderItem(onRename);

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    const input = screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "client/api" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project name" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe('Project name cannot contain "/".'),
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps editing when persistence fails", async () => {
    const onRename = vi.fn(async () => ({
      ok: false as const,
      error: "save_failed" as const,
    }));
    renderItem(onRename);

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    const input = screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Client Web" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project name" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Failed to save the project name."),
    );
    expect(input.value).toBe("Client Web");
  });

  it("cancels with Escape and keeps row actions independent", async () => {
    const { onOpen, onDelete } = renderItem();

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Project name" }), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
