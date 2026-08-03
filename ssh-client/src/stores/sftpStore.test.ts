import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("../api/localFs", () => ({ listLocalRoots: vi.fn() }));
vi.mock("../api/sftp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/sftp")>();
  return {
    ...actual,
    listRemote: vi.fn(),
    uploadRemote: vi.fn(),
    downloadRemote: vi.fn(),
  };
});

import { readDir } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { listLocalRoots } from "../api/localFs";
import {
  downloadRemote,
  listRemote,
  uploadRemote,
  type SftpEntryDTO,
} from "../api/sftp";
import {
  localCrumbs,
  localParentPath,
  normalizeLocalPath,
  normalizeRemotePath,
  remoteCrumbs,
  remoteParentPath,
  useSftpStore,
} from "./sftpStore";

const getTransfer = () => useSftpStore.getState().transfers[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useSftpStore.setState({
    connectionId: "conn-1",
    transfers: [],
    remoteCwd: "~",
    remoteEntries: [],
    remoteCwds: {},
    loading: false,
    error: null,
  });
  vi.mocked(downloadRemote).mockResolvedValue(undefined);
  vi.mocked(uploadRemote).mockResolvedValue(undefined);
  vi.mocked(readDir).mockResolvedValue([]);
  vi.mocked(openPath).mockResolvedValue(undefined);
  vi.mocked(listRemote).mockResolvedValue([]);
  vi.mocked(listLocalRoots).mockResolvedValue(["C:\\", "D:\\"]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SFTP 路径模型", () => {
  it("以当前远程目录解析相对路径并规范化 . 与 ..", () => {
    expect(normalizeRemotePath("app", "/var/log")).toBe("/var/log/app");
    expect(normalizeRemotePath("../tmp", "/var/log")).toBe("/var/tmp");
    expect(normalizeRemotePath("./logs/../app", "~/work")).toBe("~/work/app");
    expect(normalizeRemotePath("/var//./log/", "~")).toBe("/var/log");
    expect(normalizeRemotePath("..", "~")).toBe("/");
  });

  it("为远程根、家目录和子目录生成可回溯的面包屑", () => {
    expect(remoteCrumbs("/").map((c) => c.label)).toEqual(["/"]);
    expect(remoteCrumbs("~").map((c) => c.label)).toEqual(["/", "~"]);
    expect(remoteCrumbs("~/logs").map((c) => c.label)).toEqual([
      "/",
      "~",
      "logs",
    ]);
    expect(remoteParentPath("~")).toBe("/");
    expect(remoteParentPath("~/logs")).toBe("~");
    expect(remoteParentPath("/")).toBe("/");
  });

  it("规范化 Windows 绝对路径并正确处理盘符与 UNC 根", () => {
    expect(normalizeLocalPath("C:\\work\\..\\logs")).toBe("C:\\logs");
    expect(normalizeLocalPath("\\\\server\\share\\folder\\..\\logs")).toBe(
      "\\\\server\\share\\logs",
    );
    expect(localParentPath("C:\\")).toBe("C:\\");
    expect(localParentPath("C:\\logs")).toBe("C:\\");
    expect(localParentPath("\\\\server\\share\\")).toBe("\\\\server\\share\\");
    expect(
      localCrumbs("\\\\server\\share\\folder").map((c) => c.label),
    ).toEqual(["\\\\server\\share\\", "folder"]);
  });
});

describe("SFTP 导航状态", () => {
  it("最后一次远程导航请求优先，旧响应不能覆盖新目录", async () => {
    let resolveFirst: (entries: SftpEntryDTO[]) => void = () => undefined;
    let resolveSecond: (entries: SftpEntryDTO[]) => void = () => undefined;
    const first = new Promise<SftpEntryDTO[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<SftpEntryDTO[]>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(listRemote)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    const firstNavigation = useSftpStore.getState().openRemoteDir("/one");
    const secondNavigation = useSftpStore.getState().openRemoteDir("/two");
    resolveSecond([{ name: "two", directory: true, size: 0, lastModified: 0 }]);
    await secondNavigation;
    resolveFirst([{ name: "one", directory: true, size: 0, lastModified: 0 }]);
    await firstNavigation;

    expect(useSftpStore.getState().remoteCwd).toBe("/two");
    expect(useSftpStore.getState().remoteEntries[0]?.name).toBe("two");
    expect(useSftpStore.getState().loading).toBe(false);
  });

  it("最后一次本地导航请求优先，旧 readDir 响应不能覆盖新目录", async () => {
    type ReadDirEntries = Awaited<ReturnType<typeof readDir>>;
    let resolveFirst: (entries: ReadDirEntries) => void = () => undefined;
    let resolveSecond: (entries: ReadDirEntries) => void = () => undefined;
    const first = new Promise<ReadDirEntries>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<ReadDirEntries>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(readDir).mockReturnValueOnce(first).mockReturnValueOnce(second);

    const firstNavigation = useSftpStore.getState().openLocalDir("C:\\one");
    const secondNavigation = useSftpStore.getState().openLocalDir("D:\\two");
    resolveSecond([]);
    await secondNavigation;
    resolveFirst([]);
    await firstNavigation;

    expect(useSftpStore.getState().localCwd).toBe("D:\\two");
    expect(useSftpStore.getState().localLoading).toBe(false);
  });

  it("按连接记忆远程目录，本地状态不依赖连接", async () => {
    await useSftpStore.getState().openRemoteDir("/var/log");
    useSftpStore.setState({ localCwd: "D:\\work" });

    useSftpStore.getState().setConnection("conn-2");
    await Promise.resolve();
    expect(useSftpStore.getState().remoteCwd).toBe("~");

    useSftpStore.getState().setConnection("conn-1");
    await Promise.resolve();
    expect(useSftpStore.getState().remoteCwd).toBe("/var/log");
    expect(useSftpStore.getState().localCwd).toBe("D:\\work");
  });

  it("切换目录后传输仍使用启动时的完整目标路径，不刷新别的当前目录", async () => {
    useSftpStore.setState({ remoteCwd: "/var/log", localCwd: "C:\\inbox" });

    await useSftpStore
      .getState()
      .upload("C:\\work\\app.txt", "../archive/app.txt", false);
    expect(uploadRemote).toHaveBeenCalledWith(
      "conn-1",
      "C:\\work\\app.txt",
      "/var/archive/app.txt",
      false,
      expect.any(Function),
    );

    await useSftpStore
      .getState()
      .download("../logs/app.log", "C:\\other\\app.log");
    expect(downloadRemote).toHaveBeenCalledWith(
      "conn-1",
      "/var/logs/app.log",
      "C:\\other\\app.log",
      expect.any(Function),
    );
    expect(readDir).not.toHaveBeenCalled();
  });
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
