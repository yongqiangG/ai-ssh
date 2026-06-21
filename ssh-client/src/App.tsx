import Header from "./components/Header";
import ActivityBar from "./components/ActivityBar";
import LeftSidebar from "./components/LeftSidebar";
import Splitter from "./components/Splitter";
import TerminalPanel from "./views/TerminalPanel";
import ChatPanel from "./views/ChatPanel";
import Icon from "./components/Icon";
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

        <div className={styles.center}>
          {showTerminal ? (
            <TerminalPanel />
          ) : (
            <EmptyCenter
              title="终端已隐藏"
              hint="点击右上角「终端」按钮恢复显示"
              onRestore={toggleTerminal}
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

interface EmptyCenterProps {
  title: string;
  hint: string;
  onRestore: () => void;
}

function EmptyCenter({ title, hint, onRestore }: EmptyCenterProps) {
  return (
    <div className={styles.emptyCenter}>
      <Icon name="terminal" size={40} className={styles.emptyIcon} />
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyHint}>{hint}</div>
      <button className="btn" onClick={onRestore}>
        显示终端
      </button>
    </div>
  );
}
