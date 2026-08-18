import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n, type AppLanguage } from "../i18n";

// toast 桌面通知设置的词条必须 en/zh 双语齐整——Rust 侧状态词另有映射，
// 这里只守设置面板自身的 UI 文案（docs/actions/260817 阶段 3）。
// attentionBanner.* 是应用内横幅（260818）的词条，同受双语齐整约束。
const DESKTOP_NOTIFICATION_KEYS = [
  "appSettings.attentionBadgeDesktop",
  "appSettings.attentionBadgeDesktopToggle",
  "appSettings.attentionBadgeDesktopHint",
  "attentionBanner.needsConfirmation",
  "attentionBanner.awaitingReview",
  "attentionBanner.morePending",
  "attentionBanner.jumpAria",
  "attentionBanner.dismissAria",
] as const;

describe("桌面通知设置词条", () => {
  for (const language of ["en", "zh"] as AppLanguage[]) {
    it(`${language} 词条齐整（t() 不回退 key）`, () => {
      const { result } = renderHook(() => useI18n(), {
        wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider>,
      });
      result.current.setLanguage(language);
      for (const key of DESKTOP_NOTIFICATION_KEYS) {
        const text = result.current.t(key);
        expect(text, `${language} 缺词条 ${key}`).not.toBe(key);
        expect(text.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
