import { useCallback, useState } from "react";
import TopBar from "./components/TopBar";
import Splitter from "./components/Splitter";
import ServersPanel from "./views/ServersPanel";
import TerminalPanel from "./views/TerminalPanel";
import ChatPanel from "./views/ChatPanel";
import styles from "./App.module.css";

const MIN_LEFT = 220;
const MAX_LEFT = 560;
const MIN_RIGHT = 300;
const MAX_RIGHT = 760;

export default function App() {
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(380);

  const onDragLeft = useCallback((dx: number) => {
    setLeftWidth((w) => Math.min(MAX_LEFT, Math.max(MIN_LEFT, w + dx)));
  }, []);

  // 右栏贴右侧：向右拖（dx>0）应缩小右栏宽度
  const onDragRight = useCallback((dx: number) => {
    setRightWidth((w) => Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, w - dx)));
  }, []);

  return (
    <div className={styles.app}>
      <TopBar />
      <div className={styles.workspace}>
        <div className={styles.host} style={{ width: leftWidth }}>
          <ServersPanel />
        </div>
        <Splitter onDrag={onDragLeft} />
        <div className={`${styles.host} ${styles.center}`}>
          <TerminalPanel />
        </div>
        <Splitter onDrag={onDragRight} />
        <div className={styles.host} style={{ width: rightWidth }}>
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
