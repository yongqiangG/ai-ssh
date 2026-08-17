import { useEffect } from "react";
import AiCodingApp from "./AiCodingApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { AI_CODING_PANEL_VISIBILITY_EVENT, type AiCodingPanelVisibilityDetail } from "./components/terminalShared";
import { I18nProvider } from "./i18n";
import styles from "./AiCodingPanel.module.css";

/**
 * AI Coding 整窗面板（docs/situations/260815-ai-coding-panel.md）。
 *
 * 功能域独立：不经 ssh-server，数据落本地 ~/.ai-ssh/coding/（Rust coding/
 * 模块），与 SSH 运维链路零共享。这里只是薄包装：错误边界 + i18n/toast
 * providers + 迁移自 nezha 的 AiCodingApp 根组件。
 *
 * App.tsx 侧首次进入后本面板常驻挂载（display 切换而非卸载，见 App.tsx
 * 保活注释）。active prop 跟随 centerView：
 * - body.ai-coding-active 跟随 active 切换（为 aiCoding 的 CSS 变量
 *   （styles/themes.css）提供作用域，保证 Radix Portal 弹层也能取到令牌，
 *   且不影响 SSH 视图的 --vsc-* 体系；切走时摘除，SSH 视图拿到干净 body）。
 * - 广播 AI_CODING_PANEL_VISIBILITY_EVENT，消费方：AiCodingApp（window 级
 *   快捷键激活门、关闭看板浮层防 Portal 残留）、TerminalView（切回刷新）。
 */
export default function AiCodingPanel({ active }: { active: boolean }) {
  useEffect(() => {
    document.body.classList.toggle("ai-coding-active", active);
    window.dispatchEvent(
      new CustomEvent<AiCodingPanelVisibilityDetail>(AI_CODING_PANEL_VISIBILITY_EVENT, {
        detail: { active },
      }),
    );
    return () => {
      document.body.classList.remove("ai-coding-active");
    };
  }, [active]);

  return (
    <div className={styles.panel}>
      <ErrorBoundary label="AI Coding">
        <I18nProvider>
          <ToastProvider>
            <AiCodingApp />
          </ToastProvider>
        </I18nProvider>
      </ErrorBoundary>
    </div>
  );
}
