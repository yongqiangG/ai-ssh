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
import { listLocalRoots } from "../api/localFs";
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
  remoteCwds: Record<string, string>;
  remoteEntries: SftpEntryDTO[];
  loading: boolean;
  error: string | null;

  // === 本地侧 ===
  localCwd: string;
  localRoots: string[];
  localEntries: SftpEntryDTO[];
  localLoading: boolean;
  localError: string | null;

  // === 传输 ===
  transfers: TransferItem[];

  setConnection: (id: string | null) => void;
  openRemoteDir: (path: string) => Promise<boolean>;
  refreshRemote: () => Promise<boolean>;

  initLocal: () => Promise<void>;
  openLocalDir: (path: string) => Promise<boolean>;
  refreshLocal: () => Promise<boolean>;

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

export const useSftpStore = create<SftpState>((set, get) => {
  let remoteRequestSeq = 0;
  let localRequestSeq = 0;

  return {
    connectionId: null,
    remoteCwd: "~",
    remoteCwds: {},
    remoteEntries: [],
    loading: false,
    error: null,
    localCwd: "",
    localRoots: [],
    localEntries: [],
    localLoading: false,
    localError: null,
    transfers: [],

    setConnection: (id) => {
      remoteRequestSeq += 1;
      const nextCwd = id ? (get().remoteCwds[id] ?? "~") : "~";
      set({
        connectionId: id,
        remoteCwd: nextCwd,
        remoteEntries: [],
        loading: false,
        error: null,
      });
      if (id) void get().openRemoteDir(nextCwd);
    },

    openRemoteDir: async (path) => {
      const id = get().connectionId;
      if (!id) return false;
      const normalizedPath = normalizeRemotePath(path, get().remoteCwd);
      const requestId = ++remoteRequestSeq;
      set({ loading: true, error: null });
      try {
        const entries = await listRemote(id, normalizedPath);
        if (requestId !== remoteRequestSeq || get().connectionId !== id) {
          return false;
        }
        set((state) => ({
          remoteCwd: normalizedPath,
          remoteEntries: entries,
          loading: false,
          remoteCwds: {
            ...state.remoteCwds,
            [id]: normalizedPath,
          },
        }));
        return true;
      } catch (e) {
        if (requestId !== remoteRequestSeq || get().connectionId !== id) {
          return false;
        }
        set({ loading: false, error: errMsg(e) });
        return false;
      }
    },

    refreshRemote: async () => get().openRemoteDir(get().remoteCwd),

    initLocal: async () => {
      if (get().localCwd) return;
      try {
        const [home, roots] = await Promise.all([homeDir(), listLocalRoots()]);
        set({ localRoots: roots });
        await get().openLocalDir(home);
      } catch (e) {
        set({ localError: "本地侧需在桌面应用中运行：" + errMsg(e) });
      }
    },

    openLocalDir: async (path) => {
      const requestId = ++localRequestSeq;
      let normalizedPath: string;
      try {
        normalizedPath = normalizeLocalPath(path);
      } catch (e) {
        if (requestId === localRequestSeq) set({ localError: errMsg(e) });
        return false;
      }
      set({ localLoading: true, localError: null });
      try {
        const raw = await readDir(normalizedPath);
        if (requestId !== localRequestSeq) return false;
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
        set({
          localCwd: normalizedPath,
          localEntries: entries,
          localLoading: false,
        });
        return true;
      } catch (e) {
        if (requestId !== localRequestSeq) return false;
        set({ localLoading: false, localError: errMsg(e) });
        return false;
      }
    },

    refreshLocal: async () => {
      if (!get().localCwd) return false;
      return get().openLocalDir(get().localCwd);
    },

    upload: async (localPath, remotePath, overwrite) => {
      const id = get().connectionId;
      if (!id) return;
      const targetRemotePath = normalizeRemotePath(remotePath, get().remoteCwd);
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
        await uploadRemote(id, localPath, targetRemotePath, overwrite, (p) =>
          get().patchTransfer(txId, { progress: p }),
        );
        get().patchTransfer(txId, { status: "done", progress: 1 });
        if (remoteParentPath(targetRemotePath) === get().remoteCwd) {
          void get().refreshRemote();
        }
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
      const targetRemotePath = normalizeRemotePath(remotePath, get().remoteCwd);
      const txId = nextTxId();
      set((s) => ({
        transfers: [
          ...s.transfers,
          {
            id: txId,
            direction: "download",
            name: basename(targetRemotePath),
            progress: 0,
            status: "running",
            localPath,
            openState: "idle",
          },
        ],
      }));
      try {
        await downloadRemote(id, targetRemotePath, localPath, (p) =>
          get().patchTransfer(txId, { progress: p }),
        );
        get().patchTransfer(txId, { status: "done", progress: 1 });
        if (localParentPath(localPath) === get().localCwd) {
          void get().refreshLocal();
        }
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
          const current = get().transfers.find(
            (item) => item.id === transferId,
          );
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
        transfers: s.transfers.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      })),

    clearTransfer: (id) =>
      set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
  };
});

// === 远程路径工具（~ 与绝对路径通用） ===

export function joinRemotePath(cwd: string, name: string): string {
  return normalizeRemotePath(name, cwd);
}

export function remoteCrumbs(cwd: string): { label: string; path: string }[] {
  const normalized = normalizeRemotePath(cwd);
  const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  if (normalized === "/") return crumbs;
  if (normalized === "~" || normalized.startsWith("~/")) {
    crumbs.push({ label: "~", path: "~" });
    const parts = normalized.slice(2).split("/").filter(Boolean);
    let acc = "~";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }
  const parts = normalized.slice(1).split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    crumbs.push({ label: p, path: acc });
  }
  return crumbs;
}

function parseRemoteAnchor(path: string): {
  anchor: "home" | "root";
  parts: string[];
} {
  const value = path.trim().replace(/\\/g, "/");
  if (value === "~" || value.startsWith("~/")) {
    return { anchor: "home", parts: value.slice(1).split("/") };
  }
  if (value.startsWith("/")) {
    return { anchor: "root", parts: value.split("/") };
  }
  return { anchor: "root", parts: [] };
}

function formatRemotePath(anchor: "home" | "root", parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (anchor === "home") return clean.length ? `~/${clean.join("/")}` : "~";
  return clean.length ? `/${clean.join("/")}` : "/";
}

/** 以当前远程目录为基准解析 ~、绝对路径和相对路径。 */
export function normalizeRemotePath(path: string, base = "~"): string {
  const raw = path.trim().replace(/\\/g, "/");
  const baseAnchor = parseRemoteAnchor(base);
  const anchored = raw === "~" || raw.startsWith("~/") || raw.startsWith("/");
  const parsed = anchored ? parseRemoteAnchor(raw) : baseAnchor;
  const parts = anchored
    ? parsed.parts
    : [...baseAnchor.parts, ...raw.split("/")];
  let anchor = parsed.anchor;
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (result.length > 0) result.pop();
      else if (anchor === "home") anchor = "root";
      continue;
    }
    result.push(part);
  }
  return formatRemotePath(anchor, result);
}

export function remoteParentPath(cwd: string): string {
  const normalized = normalizeRemotePath(cwd);
  if (normalized === "/") return "/";
  if (normalized === "~") return "/";
  if (normalized.startsWith("~/")) {
    const parts = normalized.slice(2).split("/").filter(Boolean);
    parts.pop();
    return parts.length > 0 ? `~/${parts.join("/")}` : "~";
  }
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

// === 本地路径工具（Windows \ 与 Unix / 兼容） ===

export function joinLocalPath(cwd: string, name: string): string {
  if (cwd.endsWith("\\") || cwd.endsWith("/")) return cwd + name;
  const sep = cwd.includes("/") && !cwd.includes("\\") ? "/" : "\\";
  return cwd + sep + name;
}

export function localCrumbs(cwd: string): { label: string; path: string }[] {
  const normalized = normalizeLocalPath(cwd);
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\").filter(Boolean);
    const server = parts.shift() ?? "";
    const share = parts.shift() ?? "";
    const root = `\\\\${server}\\${share}\\`;
    const crumbs: { label: string; path: string }[] = [
      { label: root, path: root },
    ];
    let acc = root;
    for (const p of parts) {
      acc += acc.endsWith("\\") ? p : `\\${p}`;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    const root = parts[0].toUpperCase() + "\\";
    crumbs.push({ label: root, path: root });
    let acc = root;
    for (let i = 1; i < parts.length; i++) {
      acc += acc.endsWith("\\") ? parts[i] : `\\${parts[i]}`;
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

function normalizeSegments(parts: string[]): string[] {
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (result.length > 0) result.pop();
      continue;
    }
    result.push(part);
  }
  return result;
}

/** 规范化 Windows 盘符、UNC 或 POSIX 绝对路径；相对路径直接拒绝。 */
export function normalizeLocalPath(path: string): string {
  const value = path.trim();
  const drive = value.match(/^([a-zA-Z]):(?:[\\/](.*))?$/);
  if (drive) {
    const parts = normalizeSegments(
      (drive[2] ?? "").replace(/\//g, "\\").split("\\"),
    );
    return `${drive[1].toUpperCase()}:\\${parts.join("\\")}`;
  }
  const unc = value.match(/^\\\\([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/);
  if (unc) {
    const parts = normalizeSegments(
      (unc[3] ?? "").replace(/\//g, "\\").split("\\"),
    );
    return `\\\\${unc[1]}\\${unc[2]}\\${parts.join("\\")}`;
  }
  if (value.startsWith("/")) {
    const parts = normalizeSegments(value.split("/"));
    return parts.length ? `/${parts.join("/")}` : "/";
  }
  throw new Error("本地路径必须是绝对路径（如 C:\\work 或 \\\\server\\share）");
}

export function localParentPath(cwd: string): string {
  const normalized = normalizeLocalPath(cwd);
  const crumbs = localCrumbs(normalized);
  return crumbs.length > 1 ? crumbs[crumbs.length - 2].path : normalized;
}
