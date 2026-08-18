import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
import { setPendingCodingNavigation } from "./features/aiCoding/pendingNavigation";
import { AttentionBanners } from "./features/aiCoding/components/AttentionBanners";
import { I18nProvider } from "./features/aiCoding/i18n";
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

  // toast 点击回跳（docs/actions/260817 阶段 2）：单实例回调解析 launch 参数后
  // emit coding:navigate。监听必须在 AiCodingPanel 之外——SSH 视图下面板是
  // 卸载的，而「人在 SSH 视图」恰是通知主场景。切视图 + 写桥，具体任务定位
  // 由 AiCodingApp 挂载后消费（pendingNavigation「留货待取」）。
  useEffect(() => {
    const promise = listen<{ task_id: string }>("coding:navigate", (e) => {
      useLayoutStore.getState().setCenterView("aiCoding");
      setPendingCodingNavigation({ taskId: e.payload.task_id });
    });
    return () => {
      promise.then((unlisten) => unlisten());
    };
  }, []);

  const sidebarWidth = ACTIVITY_BAR_WIDTH + leftWidth;

  // AI Coding 保活：首次进入后 AiCodingPanel 常驻挂载，切换视图走 display 而非
  // 卸载。卸载会丢掉整棵前端状态树（任务列表/选中项目/终端缓冲），切回重挂载时
  // 活任务被 normalizeInterruptedTasksOnStartup 判为 detached（「终端连接已断开」
  // 假象）；进程层从不因切视图被杀（kill_all_children 仅挂窗口关闭）。保活后
  // 切回即原样恢复，后台任务状态经 Tauri 事件持续同步进内存 state。
  const [aiCodingMounted, setAiCodingMounted] = useState(centerView === "aiCoding");
  useEffect(() => {
    if (centerView === "aiCoding") setAiCodingMounted(true);
  }, [centerView]);

  // 启动门未通过（booting/failed）时全屏遮罩接管，主界面不挂载
  if (bootPhase !== "done") {
    return <BootSplash />;
  }

  return (
    <div className={styles.app}>
      {/* AI Coding 整窗接管层：仅保留 ActivityBar 作为回到 SSH 运维视图的入口；
          非激活时 display:none 冻结（内部本就按多项目 display:none 保活设计）。
          ActivityBar 只在激活时渲染：其 indicator 用 framer-motion layoutId，
          双实例共存（隐藏层 + SSH 侧栏）会共享布局动画导致指示条错位；它是
          无状态展示组件，按需挂卸零损失。 */}
      {aiCodingMounted && (
        <div
          className={styles.workspace}
          style={centerView === "aiCoding" ? undefined : { display: "none" }}
        >
          {centerView === "aiCoding" && <ActivityBar />}
          <AiCodingPanel active={centerView === "aiCoding"} />
        </div>
      )}
      {centerView !== "aiCoding" && (
        <>
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
        </>
      )}
      {/* 应用内待确认横幅：全局层（两个视图世界之外），自带 I18nProvider
          （宿主在 AiCodingPanel 的 provider 作用域外） */}
      <I18nProvider>
        <AttentionBanners />
      </I18nProvider>
    </div>
  );
}
