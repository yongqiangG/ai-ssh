import { useEffect } from "react";
import Header from "./components/Header";
import ActivityBar from "./components/ActivityBar";
import LeftSidebar from "./components/LeftSidebar";
import Splitter from "./components/Splitter";
import TerminalPanel from "./views/TerminalPanel";
import ChatPanel from "./views/ChatPanel";
import SftpPanel from "./views/SftpPanel";
import EmptyState from "./components/EmptyState";
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
  const waitForReady = useBackendStore((s) => s.waitForReady);

  useEffect(() => {
    let cancelled = false;

    void waitForReady()
      .then(async () => {
        if (cancelled) return;
        await Promise.allSettled([
          useConnectionStore.getState().fetchList(),
          useChatStore.getState().loadAgents(),
        ]);
      })
      .catch(() => {
        // ready 状态和错误信息已写入 backendStore，面板负责展示重试入口。
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, waitForReady]);

  const sidebarWidth = ACTIVITY_BAR_WIDTH + leftWidth;

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
