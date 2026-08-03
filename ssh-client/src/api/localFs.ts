import { invoke } from "@tauri-apps/api/core";

/** 返回当前桌面环境中可读取的本地根目录。 */
export function listLocalRoots(): Promise<string[]> {
  return invoke<string[]>("list_local_roots");
}
