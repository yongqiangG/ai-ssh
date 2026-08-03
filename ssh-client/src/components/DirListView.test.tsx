import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SftpEntryDTO } from "../api/sftp";
import DirListView, { type Crumb } from "./DirListView";

const entries: SftpEntryDTO[] = [
  { name: "logs", directory: true, size: 0, lastModified: 0 },
  { name: "app.LOG", directory: false, size: 1024, lastModified: 0 },
  { name: "catalog.json", directory: false, size: 2048, lastModified: 0 },
  { name: "readme.md", directory: false, size: 128, lastModified: 0 },
];

const localCrumbs: Crumb[] = [{ label: "work", path: "C:\\work" }];

function props(
  overrides: Partial<React.ComponentProps<typeof DirListView>> = {},
) {
  const crumbs = overrides.crumbs ?? localCrumbs;
  const cwd = overrides.cwd ?? crumbs[crumbs.length - 1]?.path ?? "";
  return {
    title: "本地",
    side: "local" as const,
    cwd,
    parentPath: "C:\\",
    crumbs,
    entries,
    loading: false,
    error: null,
    onNavigate: vi.fn().mockResolvedValue(true),
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe("SFTP 当前目录搜索", () => {
  it("输入时按文件和文件夹名称实时执行忽略大小写的子串过滤", () => {
    render(<DirListView {...props()} />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "搜索本地当前目录" }),
      {
        target: { value: "  LOG  " },
      },
    );

    expect(
      screen.getAllByRole("listitem").map((row) => row.textContent),
    ).toEqual(["logs", "app.LOG1.0 KB", "catalog.json2.0 KB"]);
    expect(screen.queryByText("readme.md")).toBeNull();
  });

  it("无匹配时显示搜索空态，并支持按钮与 Escape 清空", () => {
    render(<DirListView {...props()} />);
    const input = screen.getByRole("textbox", { name: "搜索本地当前目录" });

    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByText("未找到匹配“missing”的文件或文件夹")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("listitem")).toHaveLength(entries.length);

    fireEvent.change(input, { target: { value: "readme" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("listitem")).toHaveLength(entries.length);
  });

  it("同一路径刷新保留搜索词，切换路径时清空", () => {
    const { rerender } = render(<DirListView {...props()} />);
    const input = screen.getByRole("textbox", { name: "搜索本地当前目录" });
    fireEvent.change(input, { target: { value: "log" } });

    const refreshedEntries = [
      ...entries,
      {
        name: "server.log",
        directory: false,
        size: 64,
        lastModified: 0,
      },
    ];
    rerender(<DirListView {...props({ entries: refreshedEntries })} />);
    expect((input as HTMLInputElement).value).toBe("log");
    expect(screen.getByText("server.log")).toBeTruthy();

    rerender(
      <DirListView
        {...props({
          crumbs: [
            ...localCrumbs,
            { label: "nested", path: "C:\\work\\nested" },
          ],
          entries: refreshedEntries,
        })}
      />,
    );
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("listitem")).toHaveLength(
      refreshedEntries.length,
    );

    rerender(<DirListView {...props({ entries: refreshedEntries })} />);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("本地与远程搜索状态独立", () => {
    render(
      <>
        <DirListView {...props()} />
        <DirListView
          {...props({
            title: "远程",
            side: "remote",
            crumbs: [{ label: "~", path: "~" }],
          })}
        />
      </>,
    );

    const localInput = screen.getByRole("textbox", {
      name: "搜索本地当前目录",
    });
    fireEvent.change(localInput, {
      target: { value: "readme" },
    });

    expect(
      within(localInput.parentElement!.parentElement!).getByText("readme.md"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "搜索远程当前目录",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(screen.getAllByRole("listitem")).toHaveLength(entries.length + 1);
  });

  it("加载期间禁用并保留搜索框，失败时优先显示读取错误", () => {
    const { rerender } = render(<DirListView {...props()} />);
    const input = screen.getByRole("textbox", { name: "搜索本地当前目录" });
    fireEvent.change(input, { target: { value: "missing" } });

    rerender(<DirListView {...props({ loading: true })} />);
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect((input as HTMLInputElement).value).toBe("missing");
    expect(screen.getByText("加载中…")).toBeTruthy();

    rerender(<DirListView {...props({ error: "读取目录失败" })} />);
    expect(screen.getByText("读取目录失败")).toBeTruthy();
    expect(screen.queryByText("未找到匹配“missing”的文件或文件夹")).toBeNull();
  });
});
