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
const DEFAULT_BASE_URL = import.meta.env.DEV ? "" : "http://127.0.0.1:8091";

/** 后端统一响应结构，对应服务端 Response<T> */
export interface ApiResponse<T> {
  code: string;
  info: string;
  data: T;
}

/** 获取后端基地址；"" 表示开发环境走 vite 代理 */
export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY)?.trim() || DEFAULT_BASE_URL;
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

/**
 * 测试后端可达性：对 /api/ping 发一次 GET，校验响应 code==="0000"。
 *
 * 与 {@link request} 不同，这里使用传入的 {@code baseUrl}（输入框当前值），
 * 而非已保存值——让用户改完地址即可直接验证，无需先保存。
 *
 * @param baseUrl 待测基地址；"" 表示开发环境走 vite 代理
 * @throws Error 网络不可达、响应非 JSON 或后端返回非成功码时
 */
export async function pingBackend(baseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(baseUrl + "/api/ping", {
      headers: { "X-User-Id": getUserId() },
    });
  } catch (e) {
    throw new Error(
      `无法连接后端服务，请检查地址设置：${e instanceof Error ? e.message : String(e)}`
    );
  }

  let json: ApiResponse<unknown>;
  try {
    json = (await res.json()) as ApiResponse<unknown>;
  } catch {
    throw new Error(`后端响应解析失败（HTTP ${res.status}）`);
  }

  if (json.code !== SUCCESS_CODE) {
    throw new Error(json.info || `请求失败：${json.code}`);
  }
}
