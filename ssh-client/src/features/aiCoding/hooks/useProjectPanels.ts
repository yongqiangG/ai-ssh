import { useState, useCallback, useRef, useEffect } from "react";

type RightPanel = "files" | null;
type OpenFileTab = { path: string; name: string };

/**
 * 拖拽改宽/改高的共享实现（260820 评审 P3-c）。
 *
 * 兜底四件套 + 回窗检测，对齐域内 ProjectRail/FileExplorer 的拖拽标准：
 * - pointermove/pointerup/pointercancel + window blur：窗外释放（Windows 不向
 *   窗口派发窗外的 mouseup）、点取消、切窗都能终止拖拽；
 * - `ev.buttons === 0`：窗外释放后指针回到窗口时，首个 pointermove 已无按键
 *   按下——立即终止，不再要求用户补一次点击；
 * - 结束回调存 ref，组件卸载时兜底调用——旧实现仅靠 mouseup 自移除，拖拽
 *   中卸载会让 document 级监听连同 setState 闭包悬挂到下一次任意 mouseup。
 */
function startPointerDragResize(
  e: React.MouseEvent,
  axis: "x" | "y",
  cursor: string,
  onEndRef: React.RefObject<(() => void) | null>,
  onMove: (delta: number) => void,
) {
  e.preventDefault();
  const start = axis === "x" ? e.clientX : e.clientY;
  const handleMove = (ev: PointerEvent) => {
    // 窗外已释放、指针回窗：首个 move 无按键按下，终止拖拽
    if (ev.buttons === 0) {
      end();
      return;
    }
    const cur = axis === "x" ? ev.clientX : ev.clientY;
    onMove(start - cur);
  };
  const end = () => {
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onEndRef.current = null;
  };
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);
  onEndRef.current = end;
}

export function useProjectPanels() {
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [openFilesState, setOpenFilesState] = useState<{
    tabs: OpenFileTab[];
    activePath: string | null;
  }>({
    tabs: [],
    activePath: null,
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;
  const terminalHeightRef = useRef(terminalHeight);
  terminalHeightRef.current = terminalHeight;

  const handleTogglePanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const openRightPanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel(panel);
  }, []);

  const handleFileSelect = useCallback((path: string, name: string) => {
    setOpenFilesState((prev) => ({
      tabs: prev.tabs.some((tab) => tab.path === path) ? prev.tabs : [...prev.tabs, { path, name }],
      activePath: path,
    }));
  }, []);

  const handleFileTabSelect = useCallback((path: string) => {
    setOpenFilesState((prev) => ({
      tabs: prev.tabs,
      activePath: prev.tabs.some((tab) => tab.path === path) ? path : prev.activePath,
    }));
  }, []);

  const handleFileTabClose = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const closingIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (closingIndex === -1) return prev;

      const nextTabs = prev.tabs.filter((tab) => tab.path !== path);
      const nextActivePath =
        prev.activePath !== path
          ? prev.activePath
          : nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.path ?? null;

      return {
        tabs: nextTabs,
        activePath: nextActivePath,
      };
    });
  }, []);

  const handleCloseOtherFileTabs = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeTab = prev.tabs.find((tab) => tab.path === path);
      if (!activeTab) return prev;
      return {
        tabs: [activeTab],
        activePath: activeTab.path,
      };
    });
  }, []);

  const handleCloseTabsToRight = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (activeIndex === -1) return prev;

      const nextTabs = prev.tabs.slice(0, activeIndex + 1);
      return {
        tabs: nextTabs,
        activePath: nextTabs.some((tab) => tab.path === prev.activePath) ? prev.activePath : path,
      };
    });
  }, []);

  const handleCloseTabsToLeft = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (activeIndex <= 0) return prev;

      const nextTabs = prev.tabs.slice(activeIndex);
      return {
        tabs: nextTabs,
        activePath: nextTabs.some((tab) => tab.path === prev.activePath) ? prev.activePath : path,
      };
    });
  }, []);

  const handleCloseAllFileTabs = useCallback(() => {
    setOpenFilesState({
      tabs: [],
      activePath: null,
    });
  }, []);

  const clearFiles = useCallback(() => {
    setOpenFilesState({
      tabs: [],
      activePath: null,
    });
  }, []);

  // 拖拽中卸载的兜底：结束时清空（见 startPointerDragResize）
  const dragEndRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      dragEndRef.current?.();
    };
  }, []);

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    // 已有拖拽进行中（理论上手柄 mousedown 被拦，防御）：先终止旧的
    dragEndRef.current?.();
    // 基值在起点捕获一次：delta 是距起点的绝对偏移，加在实时 ref 上
    // 会在同帧多次 move 时重复叠加（React 批量渲染期间 ref 尚未更新）。
    const base = rightPanelWidthRef.current;
    startPointerDragResize(e, "x", "col-resize", dragEndRef, (delta) => {
      setRightPanelWidth(Math.max(180, Math.min(600, base + delta)));
    });
  }, []);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    dragEndRef.current?.();
    const base = terminalHeightRef.current;
    startPointerDragResize(e, "y", "row-resize", dragEndRef, (delta) => {
      setTerminalHeight(Math.max(100, Math.min(600, base + delta)));
    });
  }, []);

  return {
    rightPanel,
    openFiles: openFilesState.tabs,
    activeFilePath: openFilesState.activePath,
    rightPanelWidth,
    terminalHeight,
    openRightPanel,
    handleTogglePanel,
    handleFileSelect,
    handleFileTabSelect,
    handleFileTabClose,
    handleCloseOtherFileTabs,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFileTabs,
    clearFiles,
    handleRightResizeStart,
    handleTerminalResizeStart,
  };
}

export type { RightPanel, OpenFileTab };
