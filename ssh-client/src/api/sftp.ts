/**
 * SFTP 文件传输对接：服务端 /api/ssh/sftp。
 *
 * - list 走统一 JSON（http.get）；
 * - upload 用 multipart + XMLHttpRequest（fetch 拿不到 upload progress）；
 * - download 用 fetch 流式读 body（getReader 拿下载进度）→ tauri fs 写盘。
 *
 * upload/download 都绕开 request.ts 的 JSON 解包：上传响应手动解 ApiResponse，
 * 下载判断 content-type（失败时后端经 GlobalExceptionHandler 回 JSON）。
 */
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { http } from "./request";
import { getBaseUrl, getUserId, type ApiResponse } from "./request";

/** 远程目录条目，对应服务端 SftpEntryDTO */
export interface SftpEntryDTO {
  name: string;
  /** 是否目录 */
  directory: boolean;
  /** 字节数（目录通常为 0） */
  size: number;
  /** 最后修改时间（毫秒级时间戳） */
  lastModified: number;
}

const BASE = "/api/ssh/sftp";

/** 取路径末段文件名（Windows \ 与 Unix / 兼容） */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 列出远程目录条目；path 支持 ~ / ~/xxx / 绝对路径 */
export function listRemote(
  connectionId: string,
  path: string
): Promise<SftpEntryDTO[]> {
  const q = new URLSearchParams({ connectionId, path: path || "~" });
  return http.get<SftpEntryDTO[]>(`${BASE}/list?${q.toString()}`);
}

/**
 * 上传本地文件到远程（multipart）。onProgress 回调 0..1。
 * 仅在 Tauri 桌面壳内可用（readFile 为 tauri fs）。
 */
export function uploadRemote(
  connectionId: string,
  localPath: string,
  remotePath: string,
  overwrite: boolean,
  onProgress: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const bytes = await readFile(localPath);
        const blob = new Blob([bytes]);
        const fd = new FormData();
        fd.append("connectionId", connectionId);
        fd.append("remotePath", remotePath);
        fd.append("overwrite", String(overwrite));
        fd.append("file", blob, basename(localPath));

        const xhr = new XMLHttpRequest();
        xhr.open("POST", getBaseUrl() + `${BASE}/upload`);
        xhr.setRequestHeader("X-User-Id", getUserId());
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText) as ApiResponse<unknown>;
            if (json.code === "0000") resolve();
            else reject(new Error(json.info || "上传失败"));
          } catch {
            reject(new Error(`上传响应解析失败（HTTP ${xhr.status}）`));
          }
        };
        xhr.onerror = () => reject(new Error("上传网络错误"));
        xhr.send(fd);
      } catch (e) {
        reject(e);
      }
    })();
  });
}

/**
 * 下载远程文件到本地路径。onProgress 回调 0..1。
 * 失败（连接断/文件不存在等）若发生在首字节前，后端回 JSON，据此抛带 info 的错误。
 */
export async function downloadRemote(
  connectionId: string,
  remotePath: string,
  localPath: string,
  onProgress: (ratio: number) => void
): Promise<void> {
  const q = new URLSearchParams({ connectionId, remotePath });
  const res = await fetch(
    getBaseUrl() + `${BASE}/download?${q.toString()}`,
    { headers: { "X-User-Id": getUserId() } }
  );
  const ct = res.headers.get("content-type") || "";
  // 非 2xx 或后端回了 JSON（GlobalExceptionHandler）→ 解析错误信息
  if (!res.ok || ct.includes("application/json")) {
    let msg = `下载失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as ApiResponse<unknown>;
      msg = j.info || msg;
    } catch {
      /* 维持默认 msg */
    }
    throw new Error(msg);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("下载流不可用");
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress(received / total);
    }
  }
  const full = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    full.set(c, off);
    off += c.length;
  }
  await writeFile(localPath, full);
}
