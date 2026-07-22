import { useState } from "react";
import Icon from "./Icon";
import BackendSettingsModal from "./BackendSettingsModal";
import { useBackendStore } from "../stores/backendStore";
import styles from "./BootSplash.module.css";

/**
 * 启动遮罩（一次性启动门）。
 *
 * bootPhase 为 done 之前由本组件全屏接管：等待态展示过渡动效，失败态提供
 * 自救三件套（重试 / 修改后端地址 / 日志线索）。决议见
 * docs/situations/260722-boot-splash-and-startup-speed.md Q1/Q3。
 */
export default function BootSplash() {
  const bootPhase = useBackendStore((s) => s.bootPhase);
  const readyMessage = useBackendStore((s) => s.readyMessage);
  const boot = useBackendStore((s) => s.boot);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const failed = bootPhase === "failed";

  return (
    <div className={styles.splash}>
      <div className={styles.stage}>
        {failed ? (
          <div className={styles.failBox}>
            <div className={styles.failTitle}>后端服务未能启动</div>
            <div className={styles.failMessage}>
              {readyMessage ?? "等待本地服务就绪超时"}
            </div>
            <div className={styles.failActions}>
              <button className="btn" onClick={() => void boot()}>
                <Icon name="refresh" size={14} />
                重试
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setSettingsOpen(true)}
              >
                修改后端地址
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.waitingText}>正在启动本地服务…</div>
        )}
      </div>

      {/* 改完地址关闭弹窗即自动重试——failed 态下多试一次无害，符合「改了就该再试」的预期 */}
      <BackendSettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          void boot();
        }}
      />
    </div>
  );
}
