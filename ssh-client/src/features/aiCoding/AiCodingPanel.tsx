import { useEffect } from "react";
import AiCodingApp from "./AiCodingApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { I18nProvider } from "./i18n";
import styles from "./AiCodingPanel.module.css";

/**
 * AI Coding 整窗面板（docs/situations/260815-ai-coding-panel.md）。
 *
 * 功能域独立：不经 ssh-server，数据落本地 ~/.ai-ssh/coding/（Rust coding/
 * 模块），与 SSH 运维链路零共享。这里只是薄包装：错误边界 + i18n/toast
 * providers + 迁移自 nezha 的 AiCodingApp 根组件。
 *
 * body.ai-coding-active 由本组件挂载/卸载时切换，为 aiCoding 的 CSS 变量
 * （styles/themes.css）提供作用域，保证 Radix Portal 弹层也能取到令牌，
 * 且不影响 SSH 视图的 --vsc-* 体系。
 */
export default function AiCodingPanel() {
  useEffect(() => {
    document.body.classList.add("ai-coding-active");
    return () => {
      document.body.classList.remove("ai-coding-active");
    };
  }, []);

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
