import { useState } from "react";
import Icon, { type IconName } from "./Icon";
import BackendSettingsModal from "./BackendSettingsModal";
import { useLayoutStore, type SidebarView } from "../stores/layoutStore";
import { useThemeStore } from "../stores/themeStore";
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
];

export default function ActivityBar() {
  const active = useLayoutStore((s) => s.activeSidebarView);
  const showSidebar = useLayoutStore((s) => s.showSidebar);
  const setActiveSidebarView = useLayoutStore((s) => s.setActiveSidebarView);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const centerView = useLayoutStore((s) => s.centerView);
  const setCenterView = useLayoutStore((s) => s.setCenterView);

  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const onItemClick = (id: SidebarView) => {
    if (id === "sftp") {
      // SFTP：中间工作区切到 SFTP 面板
      setCenterView("sftp");
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
                : item.id === "servers"
                ? centerView === "terminal"
                : showSidebar && active === item.id;
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
                {isActive && <span className={styles.indicator} />}
              </button>
            );
          })}
        </div>
        <div className={styles.bottom}>
          <button
            type="button"
            className={styles.btn}
            title={mode === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            onClick={toggleTheme}
          >
            <Icon name={mode === "dark" ? "sun" : "moon"} size={22} />
          </button>
          <button
            type="button"
            className={styles.btn}
            title="设置"
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
