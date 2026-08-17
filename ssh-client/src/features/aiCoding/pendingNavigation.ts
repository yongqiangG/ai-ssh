/**
 * toast 点击回跳的跨层导航桥（docs/actions/260817 阶段 2）。
 *
 * Rust 单实例回调解析 launch 参数后 emit `coding:navigate`，由 App.tsx
 * 常驻监听写入本桥——监听必须在 AiCodingPanel 之外，因为 SSH 视图下面板
 * 是卸载的（App.tsx 条件渲染），而「人在 SSH 视图干活」恰是通知主场景。
 *
 * 桥是「留货待取」语义：面板未挂载时积压，挂载后由 AiCodingApp 在 tasks
 * 就绪时取走（peek→命中才 consume），面板挂载中则走订阅即时导航。
 */

export interface PendingCodingNavigation {
  taskId: string;
}

type Listener = (navigation: PendingCodingNavigation) => void;

let pending: PendingCodingNavigation | null = null;
const listeners = new Set<Listener>();

export function setPendingCodingNavigation(navigation: PendingCodingNavigation): void {
  pending = navigation;
  listeners.forEach((listener) => listener(navigation));
}

/** 查看积压的导航意图（不清空）。消费方在任务查找命中后再 consume。 */
export function peekPendingCodingNavigation(): PendingCodingNavigation | null {
  return pending;
}

/** 取走并清空积压的导航意图（若无返回 null）。 */
export function consumePendingCodingNavigation(): PendingCodingNavigation | null {
  const navigation = pending;
  pending = null;
  return navigation;
}

/** 订阅后续写入（面板挂载中的即时导航）；返回退订函数。 */
export function subscribePendingCodingNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
