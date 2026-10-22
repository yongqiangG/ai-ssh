// 鸿蒙 rawfile 注入模式与 web 伴侣同源模式的配置分流（阶段 1 迁移）：
// web 伴侣（维护模式）：页面由 axum 托管，fetch 相对路径 + location.host 拼 WS +
//   localStorage token——零改动。
// 鸿蒙 rawfile 本地页：原生壳经 URL query 注入 taskId/token/baseUrl，
//   fetch/WS 走绝对地址，token 不落 localStorage。
// 判定信号：URL 是否携带 baseUrl 参数。

export interface BootstrapConfig {
  /** 注入模式为 true：fetch/WS 前缀 baseUrl；false：同源相对路径 */
  injected: boolean;
  taskId: string;
  token: string;
  baseUrl: string;
}

function queryParam(name: string): string {
  const v = new URLSearchParams(location.search).get(name);
  return v ? v.trim() : "";
}

let cached: BootstrapConfig | null = null;

export function bootstrapConfig(): BootstrapConfig {
  if (cached) return cached;
  const baseUrl = queryParam("baseUrl");
  cached = {
    injected: baseUrl !== "",
    taskId: queryParam("taskId"),
    token: queryParam("token"),
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
  return cached;
}

/** fetch 用路径前缀：注入模式绝对地址，同源模式空串（相对路径原样） */
export function apiBase(): string {
  return bootstrapConfig().baseUrl;
}

/** 注入模式的 token；同源模式返回空串（调用方回落 localStorage） */
export function injectedToken(): string {
  return bootstrapConfig().injected ? bootstrapConfig().token : "";
}
