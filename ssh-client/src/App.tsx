import { useEffect } from "react";
import Header from "./components/Header";
import ActivityBar from "./components/ActivityBar";
import LeftSidebar from "./components/LeftSidebar";
import Splitter from "./components/Splitter";
import BootSplash from "./components/BootSplash";
import TerminalPanel from "./views/TerminalPanel";
import ChatPanel from "./views/ChatPanel";
import SftpPanel from "./views/SftpPanel";
import EmptyState from "./components/EmptyState";
import AiCodingPanel from "./features/aiCoding/AiCodingPanel";
import { useBackendStore } from "./stores/backendStore";
import { useChatStore } from "./stores/chatStore";
import { useConnectionStore } from "./stores/connectionStore";
import { useLayoutStore } from "./stores/layoutStore";
import styles from "./App.module.css";

const ACTIVITY_BAR_WIDTH = 48;

export default function App() {
  const showSidebar = useLayoutStore((s) => s.showSidebar);
  const showTerminal = useLayoutStore((s) => s.showTerminal);
  const showAiPanel = useLayoutStore((s) => s.showAiPanel);
  const leftWidth = useLayoutStore((s) => s.leftWidth);
  const rightWidth = useLayoutStore((s) => s.rightWidth);
  const applyLeftDrag = useLayoutStore((s) => s.applyLeftDrag);
  const applyRightDrag = useLayoutStore((s) => s.applyRightDrag);
  const toggleTerminal = useLayoutStore((s) => s.toggleTerminal);
  const centerView = useLayoutStore((s) => s.centerView);
  const baseUrl = useBackendStore((s) => s.baseUrl);
  const bootPhase = useBackendStore((s) => s.bootPhase);
  const boot = useBackendStore((s) => s.boot);

  // 一次性启动门：应用生命周期内只成功一次（boot 内部防重入与终态守卫）
  useEffect(() => {
    void boot();
  }, [boot]);

  // 就绪后加载业务数据；done 后改 baseUrl 走这里静默刷新，不再回遮罩
  useEffect(() => {
    if (bootPhase !== "done") return;
    void Promise.allSettled([
      useConnectionStore.getState().fetchList(),
      useChatStore.getState().loadAgents(),
    ]);
  }, [bootPhase, baseUrl]);

  const sidebarWidth = ACTIVITY_BAR_WIDTH + leftWidth;

  // 启动门未通过（booting/failed）时全屏遮罩接管，主界面不挂载
  if (bootPhase !== "done") {
    return <BootSplash />;
  }

  // AI Coding 整窗接管：SSH 专属的 Header/左侧栏/ChatPanel 全部隐藏，
  // 仅保留 ActivityBar 作为回到 SSH 运维视图的入口；侧栏/面板状态不动，
  // 切回时布局原样恢复
  if (centerView === "aiCoding") {
    return (
      <div className={styles.app}>
        <div className={styles.workspace}>
          <ActivityBar />
          <AiCodingPanel />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <Header />
      <div className={styles.workspace}>
        {showSidebar && (
          <>
            <div
              className={styles.sidebarHost}
              style={{ width: sidebarWidth }}
            >
              <ActivityBar />
              <div
                className={styles.sidebarContent}
                style={{ width: leftWidth }}
              >
                <LeftSidebar />
              </div>
            </div>
            <Splitter onDrag={applyLeftDrag} />
          </>
        )}

        <div id="work-center" className={styles.center}>
          {centerView === "sftp" ? (
            <SftpPanel />
          ) : showTerminal ? (
            <TerminalPanel />
          ) : (
            <EmptyState
              icon="terminal"
              title="终端已隐藏"
              hint="点击右上角「终端」按钮恢复显示"
              action={
                <button className="btn" onClick={toggleTerminal}>
                  显示终端
                </button>
              }
            />
          )}
        </div>

        {showAiPanel && (
          <>
            <Splitter onDrag={applyRightDrag} />
            <div className={styles.rightHost} style={{ width: rightWidth }}>
              <ChatPanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
