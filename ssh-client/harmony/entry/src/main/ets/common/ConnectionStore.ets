import { preferences } from '@kit.ArkData';
import { Context } from '@kit.AbilityKit';

const STORE_NAME = 'aissh_connection';
const KEY_BASE_URL = 'base_url';
const KEY_TOKEN = 'token';

/** 连接配置的存取：spike 期先落 Preferences，随协议演进就地扩展 */
export class ConnectionStore {
  static async load(context: Context): Promise<Connection> {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const baseUrl = await store.get(KEY_BASE_URL, '') as string;
    const token = await store.get(KEY_TOKEN, '') as string;
    return { baseUrl: baseUrl, token: token };
  }

  static async save(context: Context, conn: Connection): Promise<void> {
    const store = await preferences.getPreferences(context, STORE_NAME);
    await store.put(KEY_BASE_URL, conn.baseUrl);
    await store.put(KEY_TOKEN, conn.token);
    await store.flush();
  }
}

export interface Connection {
  baseUrl: string;
  token: string;
}
