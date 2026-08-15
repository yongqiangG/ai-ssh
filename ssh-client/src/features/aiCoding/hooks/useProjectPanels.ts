import { useState, useCallback, useRef } from "react";

type RightPanel = "files" | null;
type OpenFileTab = { path: string; name: string };

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

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(600, startWidth + (startX - ev.clientX)));
      setRightPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeightRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(600, startHeight + (startY - ev.clientY)));
      setTerminalHeight(newHeight);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
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
