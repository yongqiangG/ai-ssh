/**
 * SFTP 面板状态 store（zustand）。
 *
 * 三块状态：
 * - 远程侧（SFTP list）：connectionId / remoteCwd / remoteEntries
 * - 本地侧（tauri fs readDir）：localCwd / localEntries（仅桌面壳内可用）
 * - 传输项 transfers：上传/下载的实时进度（阶段 4）
 *
 * 与 connectionStore/terminalStore 的协作：
 * - 连接列表来自 connectionStore（SftpPanel 读取筛选 connected）；
 * - 默认连接锚定 terminalStore.activeId（与终端「当前操作哪台连接」共用锚点）。
 */
import { create } from "zustand";
import { readDir } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  listRemote,
  uploadRemote,
  downloadRemote,
  basename,
  type SftpEntryDTO,
} from "../api/sftp";

export interface TransferItem {
  id: string;
  direction: "upload" | "download";
  name: string;
  /** 0..1 */
  progress: number;
  status: "running" | "done" | "error";
  error?: string;
  /** 下载完成后的本地目标；上传项没有此字段。 */
  localPath?: string;
  openState?: "idle" | "opening" | "opened";
  openError?: string;
}

type ConfirmDangerousOpen = (localPath: string) => Promise<boolean>;

interface SftpState {
  // === 远程侧 ===
  connectionId: string | null;
  remoteCwd: string;
  remoteEntries: SftpEntryDTO[];
  loading: boolean;
  error: string | null;

  // === 本地侧 ===
  localCwd: string;
  localEntries: SftpEntryDTO[];
  localLoading: boolean;
  localError: string | null;

  // === 传输 ===
  transfers: TransferItem[];

  setConnection: (id: string | null) => void;
  openRemoteDir: (path: string) => Promise<void>;
  refreshRemote: () => Promise<void>;

  initLocal: () => Promise<void>;
  openLocalDir: (path: string) => Promise<void>;
  refreshLocal: () => Promise<void>;

  upload: (
    localPath: string,
    remotePath: string,
    overwrite: boolean,
  ) => Promise<void>;
  download: (remotePath: string, localPath: string) => Promise<void>;
  openDownload: (
    transferId: string,
    confirmDangerous: ConfirmDangerousOpen,
  ) => Promise<void>;
  patchTransfer: (id: string, patch: Partial<TransferItem>) => void;
  clearTransfer: (id: string) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let _seq = 0;
const nextTxId = () => "tx" + Date.now().toString(36) + (_seq++).toString(36);

const DANGEROUS_OPEN_EXTENSIONS = new Set([
  "exe",
  "com",
  "msi",
  "bat",
  "cmd",
  "ps1",
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
]);

function isDangerousToOpen(localPath: string): boolean {
  const pathParts = localPath.split(/[\\/]/);
  const fileName = pathParts[pathParts.length - 1] ?? "";
  const dot = fileName.lastIndexOf(".");
  return dot >= 0
    ? DANGEROUS_OPEN_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase())
    : false;
}

export const useSftpStore = create<SftpState>((set, get) => ({
  connectionId: null,
  remoteCwd: "~",
  remoteEntries: [],
  loading: false,
  error: null,
  localCwd: "",
  localEntries: [],
  localLoading: false,
  localError: null,
  transfers: [],

  setConnection: (id) => {
    set({ connectionId: id, remoteCwd: "~", remoteEntries: [], error: null });
    if (id) void get().openRemoteDir("~");
  },

  openRemoteDir: async (path) => {
    const id = get().connectionId;
    if (!id) return;
    set({ loading: true, error: null });
    try {
      const entries = await listRemote(id, path);
      set({ remoteCwd: path, remoteEntries: entries, loading: false });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  refreshRemote: async () => {
    await get().openRemoteDir(get().remoteCwd);
  },

  initLocal: async () => {
    if (get().localCwd) return;
    try {
      const home = await homeDir();
      await get().openLocalDir(home);
    } catch (e) {
      set({ localError: "本地侧需在桌面应用中运行：" + errMsg(e) });
    }
  },

  openLocalDir: async (path) => {
    set({ localLoading: true, localError: null });
    try {
      const raw = await readDir(path);
      const entries: SftpEntryDTO[] = raw.map((d) => ({
        name: d.name,
        directory: !!d.isDirectory,
        size: 0,
        lastModified: 0,
      }));
      entries.sort((a, b) =>
        a.directory !== b.directory
          ? a.directory
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
      set({ localCwd: path, localEntries: entries, localLoading: false });
    } catch (e) {
      set({ localLoading: false, localError: errMsg(e) });
    }
  },

  refreshLocal: async () => {
    if (get().localCwd) await get().openLocalDir(get().localCwd);
  },

  upload: async (localPath, remotePath, overwrite) => {
    const id = get().connectionId;
    if (!id) return;
    const txId = nextTxId();
    set((s) => ({
      transfers: [
        ...s.transfers,
        {
          id: txId,
          direction: "upload",
          name: basename(localPath),
          progress: 0,
          status: "running",
        },
      ],
    }));
    try {
      await uploadRemote(id, localPath, remotePath, overwrite, (p) =>
        get().patchTransfer(txId, { progress: p }),
      );
      get().patchTransfer(txId, { status: "done", progress: 1 });
      void get().refreshRemote();
      // 成功后 1.8s 自动淡出消失（toast-dismiss）；error 保留供查看
      setTimeout(() => {
        const t = get().transfers.find((x) => x.id === txId);
        if (t && t.status === "done") get().clearTransfer(txId);
      }, 1800);
    } catch (e) {
      get().patchTransfer(txId, { status: "error", error: errMsg(e) });
    }
  },

  download: async (remotePath, localPath) => {
    const id = get().connectionId;
    if (!id) return;
    const txId = nextTxId();
    set((s) => ({
      transfers: [
        ...s.transfers,
        {
          id: txId,
          direction: "download",
          name: basename(remotePath),
          progress: 0,
          status: "running",
          localPath,
          openState: "idle",
        },
      ],
    }));
    try {
      await downloadRemote(id, remotePath, localPath, (p) =>
        get().patchTransfer(txId, { progress: p }),
      );
      get().patchTransfer(txId, { status: "done", progress: 1 });
      void get().refreshLocal();
    } catch (e) {
      get().patchTransfer(txId, { status: "error", error: errMsg(e) });
    }
  },

  openDownload: async (transferId, confirmDangerous) => {
    const transfer = get().transfers.find((item) => item.id === transferId);
    if (
      !transfer ||
      transfer.direction !== "download" ||
      transfer.status !== "done" ||
      !transfer.localPath ||
      transfer.openState !== "idle"
    ) {
      return;
    }

    get().patchTransfer(transferId, {
      openState: "opening",
      openError: undefined,
    });

    if (
      isDangerousToOpen(transfer.localPath) &&
      !(await confirmDangerous(transfer.localPath))
    ) {
      get().patchTransfer(transferId, { openState: "idle" });
      return;
    }

    try {
      await openPath(transfer.localPath);
      get().patchTransfer(transferId, { openState: "opened" });
      setTimeout(() => {
        const current = get().transfers.find((item) => item.id === transferId);
        if (current?.openState === "opened") get().clearTransfer(transferId);
      }, 1800);
    } catch (e) {
      get().patchTransfer(transferId, {
        openState: "idle",
        openError: `打开文件失败（${transfer.localPath}）：${errMsg(e)}`,
      });
    }
  },

  patchTransfer: (id, patch) =>
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  clearTransfer: (id) =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
}));

// === 远程路径工具（~ 与绝对路径通用） ===

export function joinRemotePath(cwd: string, name: string): string {
  if (cwd === "~") return "~/" + name;
  if (cwd.endsWith("/")) return cwd + name;
  return cwd + "/" + name;
}

export function remoteCrumbs(cwd: string): { label: string; path: string }[] {
  if (cwd.startsWith("~")) {
    const parts = cwd.slice(1).split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [
      { label: "~", path: "~" },
    ];
    let acc = "~";
    for (const p of parts) {
      acc = acc + "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }
  const parts = cwd.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc = acc + "/" + p;
    crumbs.push({ label: p, path: acc });
  }
  return crumbs;
}

// === 本地路径工具（Windows \ 与 Unix / 兼容） ===

export function joinLocalPath(cwd: string, name: string): string {
  if (cwd.endsWith("\\") || cwd.endsWith("/")) return cwd + name;
  const sep = cwd.includes("/") && !cwd.includes("\\") ? "/" : "\\";
  return cwd + sep + name;
}

export function localCrumbs(cwd: string): { label: string; path: string }[] {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    crumbs.push({ label: parts[0] + "\\", path: parts[0] + "\\" });
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) {
      acc = acc + "\\" + parts[i];
      crumbs.push({ label: parts[i], path: acc });
    }
  } else {
    crumbs.push({ label: "/", path: "/" });
    let acc = "";
    for (const p of parts) {
      acc = acc + "/" + p;
      crumbs.push({ label: p, path: acc });
    }
  }
  return crumbs;
}
