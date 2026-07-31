import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("../api/sftp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/sftp")>();
  return {
    ...actual,
    listRemote: vi.fn(),
    uploadRemote: vi.fn(),
    downloadRemote: vi.fn(),
  };
});

import { openPath } from "@tauri-apps/plugin-opener";
import { downloadRemote } from "../api/sftp";
import { useSftpStore } from "./sftpStore";

const getTransfer = () => useSftpStore.getState().transfers[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useSftpStore.setState({ connectionId: "conn-1", transfers: [] });
  vi.mocked(downloadRemote).mockResolvedValue(undefined);
  vi.mocked(openPath).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SFTP 下载完成后打开文件", () => {
  it("下载成功保存本地完整路径，且打开前不再自动清理", async () => {
    await useSftpStore
      .getState()
      .download("~/logs/app.log", "C:\\logs\\app.log");

    expect(getTransfer()).toMatchObject({
      direction: "download",
      status: "done",
      localPath: "C:\\logs\\app.log",
      openState: "idle",
    });

    await act(async () => vi.advanceTimersByTime(1800));
    expect(useSftpStore.getState().transfers).toHaveLength(1);
  });

  it("普通文件直接打开，成功后标记已打开并延迟清理", async () => {
    await useSftpStore
      .getState()
      .download("~/logs/app.log", "C:\\logs\\app.log");
    const id = getTransfer().id;
    const confirmDangerous = vi.fn();

    await useSftpStore.getState().openDownload(id, confirmDangerous);

    expect(confirmDangerous).not.toHaveBeenCalled();
    expect(openPath).toHaveBeenCalledWith("C:\\logs\\app.log");
    expect(getTransfer()).toMatchObject({ openState: "opened" });

    await act(async () => vi.advanceTimersByTime(1799));
    expect(useSftpStore.getState().transfers).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(useSftpStore.getState().transfers).toHaveLength(0);
  });

  it("约定的危险扩展名忽略大小写并逐次确认，取消时不打开也不改状态", async () => {
    const extensions = [
      "EXE",
      "com",
      "msi",
      "bat",
      "cmd",
      "PS1",
      "vbs",
      "vbe",
      "js",
      "jse",
      "wsf",
      "wsh",
      "scr",
      "hta",
      "lnk",
      "reg",
      "jar",
    ];

    for (const extension of extensions) {
      const localPath = `C:\\tools\\repair.${extension}`;
      useSftpStore.setState({
        transfers: [
          {
            id: `tx-${extension}`,
            direction: "download",
            name: `repair.${extension}`,
            progress: 1,
            status: "done",
            localPath,
            openState: "idle",
          },
        ],
      });
      const confirmDangerous = vi.fn().mockResolvedValue(false);

      await useSftpStore
        .getState()
        .openDownload(getTransfer().id, confirmDangerous);

      expect(confirmDangerous).toHaveBeenCalledWith(localPath);
      expect(getTransfer()).toMatchObject({ openState: "idle" });
    }
    expect(openPath).not.toHaveBeenCalled();
  });

  it("危险文件经用户确认后交给系统打开", async () => {
    await useSftpStore
      .getState()
      .download("~/tools/repair.cmd", "C:\\tools\\repair.cmd");
    const confirmDangerous = vi.fn().mockResolvedValue(true);

    await useSftpStore
      .getState()
      .openDownload(getTransfer().id, confirmDangerous);

    expect(confirmDangerous).toHaveBeenCalledWith("C:\\tools\\repair.cmd");
    expect(openPath).toHaveBeenCalledWith("C:\\tools\\repair.cmd");
    expect(getTransfer()).toMatchObject({ openState: "opened" });
  });

  it("系统打开失败时恢复按钮并保留描述性错误", async () => {
    vi.mocked(openPath).mockRejectedValue(new Error("没有关联的应用"));
    await useSftpStore
      .getState()
      .download("~/logs/app.log", "C:\\logs\\app.log");

    await useSftpStore.getState().openDownload(getTransfer().id, vi.fn());

    expect(getTransfer()).toMatchObject({
      openState: "idle",
      openError: "打开文件失败（C:\\logs\\app.log）：没有关联的应用",
    });
    await act(async () => vi.advanceTimersByTime(1800));
    expect(useSftpStore.getState().transfers).toHaveLength(1);
  });
});
