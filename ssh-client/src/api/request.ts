/**
 * 通用 HTTP 封装。
 *
 * - 动态 baseURL：开发环境为空字符串（走 vite 代理 /api -> :8091）；
 *   生产环境为用户在「后端地址设置」里配置的地址（如 http://192.168.1.10:8091），持久化到 localStorage。
 * - 统一解析后端泛型响应 {@link ApiResponse}，code !== "0000" 抛出携带 info 的 Error。
 * - 自动附带 X-User-Id 头（无鉴权阶段，缺省 "default"）。
 */

const BASE_URL_KEY = "ai-ssh:baseUrl";
const USER_ID_KEY = "ai-ssh:userId";
const SUCCESS_CODE = "0000";

/** 后端统一响应结构，对应服务端 Response<T> */
export interface ApiResponse<T> {
  code: string;
  info: string;
  data: T;
}

/** 获取后端基地址；"" 表示开发环境走 vite 代理 */
export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY)?.trim() ?? "";
}

/** 设置并持久化后端基地址 */
export function setBaseUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) {
    localStorage.setItem(BASE_URL_KEY, trimmed);
  } else {
    localStorage.removeItem(BASE_URL_KEY);
  }
}

/** 获取当前用户标识（无鉴权阶段，缺省 default） */
export function getUserId(): string {
  return localStorage.getItem(USER_ID_KEY)?.trim() || "default";
}

/**
 * 发起请求并解包 ApiResponse。
 * @throws Error 当网络失败、响应非 JSON 或 code !== "0000" 时
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(getBaseUrl() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": getUserId(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `无法连接后端服务，请检查地址设置：${e instanceof Error ? e.message : String(e)}`
    );
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`后端响应解析失败（HTTP ${res.status}）`);
  }

  if (json.code !== SUCCESS_CODE) {
    throw new Error(json.info || `请求失败：${json.code}`);
  }
  return json.data;
}

export const http = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
