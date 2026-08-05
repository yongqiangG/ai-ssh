import { useState } from "react";
import { motion } from "motion/react";
import Icon, { type IconName } from "./Icon";
import BackendSettingsModal from "./BackendSettingsModal";
import { useLayoutStore, type SidebarView } from "../stores/layoutStore";
import styles from "./ActivityBar.module.css";

interface NavItem {
  id: SidebarView;
  icon: IconName;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "servers", icon: "terminal", label: "终端" },
  { id: "files", icon: "files", label: "文件" },
  { id: "sftp", icon: "sftp", label: "SFTP 传输" },
  { id: "local", icon: "bot", label: "本地开发" },
];

export default function ActivityBar() {
  const active = useLayoutStore((s) => s.activeSidebarView);
  const showSidebar = useLayoutStore((s) => s.showSidebar);
  const setActiveSidebarView = useLayoutStore((s) => s.setActiveSidebarView);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const centerView = useLayoutStore((s) => s.centerView);
  const setCenterView = useLayoutStore((s) => s.setCenterView);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const onItemClick = (id: SidebarView) => {
    if (id === "sftp") {
      // SFTP：中间工作区切到 SFTP 面板
      setActiveSidebarView("servers");
      setCenterView("sftp");
      if (!showSidebar) toggleSidebar();
      return;
    }
    if (id === "local") {
      setCenterView("local");
      setActiveSidebarView("local");
      if (!showSidebar) toggleSidebar();
      return;
    }
    if (id === "servers") {
      // 终端：切回终端工作区 + 侧栏显示连接列表
      setCenterView("terminal");
      setActiveSidebarView("servers");
      if (!showSidebar) toggleSidebar();
      return;
    }
    // files：纯侧栏视图
    setCenterView("terminal");
    setActiveSidebarView("files");
    if (!showSidebar) toggleSidebar();
  };

  return (
    <>
      <nav className={styles.bar} aria-label="侧边导航">
        <div className={styles.top}>
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.id === "sftp"
                ? centerView === "sftp"
                : item.id === "local"
                ? centerView === "local"
                : item.id === "servers"
                ? centerView === "terminal"
                : centerView === "terminal" && showSidebar && active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.btn} ${isActive ? styles.active : ""}`}
                title={item.label}
                aria-pressed={isActive}
                onClick={() => onItemClick(item.id)}
              >
                <Icon name={item.icon} size={22} />
                {isActive && (
                  <motion.span
                    layoutId="activity-indicator"
                    className={styles.indicator}
                    transition={{ type: "spring", stiffness: 520, damping: 34 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className={styles.bottom}>
          <button
            type="button"
            className={`${styles.btn} gear-spin`}
            title="后端服务设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={22} />
          </button>
        </div>
      </nav>
      <BackendSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
