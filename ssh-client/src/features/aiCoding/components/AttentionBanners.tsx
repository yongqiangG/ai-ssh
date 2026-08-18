import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAttentionStore, type AttentionBannerItem } from "../attention";
import { setPendingCodingNavigation } from "../pendingNavigation";
import { useLayoutStore } from "../../../stores/layoutStore";
import { useI18n } from "../i18n";
import styles from "./AttentionBanners.module.css";

/**
 * 应用内待确认横幅（260818 决议）：窗口聚焦但待确认任务当前不可见时弹出，
 * 8s 自动收走（ActivityBar 角标留底）；点击走 pendingNavigation 桥直达任务终端。
 *
 * 挂载在 App.tsx 根层（两个视图世界之外）——aiCoding 保活层 display:none 时
 * 内部 fixed 元素同样不可见，横幅必须全局渲染。i18n 由宿主侧 I18nProvider
 * 提供；面板内切换语言后本实例到重启才跟随（一词之差，接受）。
 */

/** 横幅驻留时长；测试可注入短值。 */
export const BANNER_TTL_MS = 8000;
const MAX_VISIBLE_BANNERS = 3;

export function AttentionBanners({ ttlMs = BANNER_TTL_MS }: { ttlMs?: number }) {
  const { t } = useI18n();
  const banners = useAttentionStore((s) => s.banners);
  const visible = banners.slice(0, MAX_VISIBLE_BANNERS);
  const overflow = banners.length - visible.length;

  if (banners.length === 0) return null;
  return (
    <div className={styles.host} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {visible.map((item) => (
          <BannerCard key={item.taskId} item={item} ttlMs={ttlMs} />
        ))}
      </AnimatePresence>
      {overflow > 0 && (
        <div className={styles.overflow}>{t("attentionBanner.morePending", { count: overflow })}</div>
      )}
    </div>
  );
}

function BannerCard({ item, ttlMs }: { item: AttentionBannerItem; ttlMs: number }) {
  const { t } = useI18n();

  // 8s 到期只杀自己这一代（seq 匹配）：期间同任务重触发已被 push 替换为新 seq，
  // 旧定时器到期不误杀重弹的新横幅
  useEffect(() => {
    const timer = setTimeout(() => {
      useAttentionStore.getState().expireAttentionBanner(item.taskId, item.seq);
    }, ttlMs);
    return () => clearTimeout(timer);
  }, [item.taskId, item.seq, ttlMs]);

  const jump = () => {
    useAttentionStore.getState().dismissAttentionBanner(item.taskId);
    useLayoutStore.getState().setCenterView("aiCoding");
    setPendingCodingNavigation({ taskId: item.taskId });
  };

  const statusWord =
    item.status === "input_required"
      ? t("attentionBanner.needsConfirmation")
      : t("attentionBanner.awaitingReview");

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={`${statusWord}：${item.title}，${t("attentionBanner.jumpAria")}`}
      className={`${styles.card} ${
        item.status === "input_required" ? styles.inputRequired : styles.awaitingReview
      }`}
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={jump}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump();
        }
      }}
    >
      <span className={styles.statusChip}>{statusWord}</span>
      <button
        type="button"
        className={styles.closeBtn}
        aria-label={t("attentionBanner.dismissAria")}
        onClick={(e) => {
          e.stopPropagation();
          useAttentionStore.getState().dismissAttentionBanner(item.taskId);
        }}
      >
        ×
      </button>
      <div className={styles.title}>{item.title}</div>
      <div className={styles.meta}>
        {item.projectName} · {item.agentName}
      </div>
    </motion.div>
  );
}
