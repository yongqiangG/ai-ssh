import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import BackendSettingsModal from "./BackendSettingsModal";
import { useBackendStore } from "../stores/backendStore";
import { estimateProgress, readExpectedBootMs } from "./bootProgress";
import styles from "./BootSplash.module.css";

/** 俏皮启动日志文案池：每次启动洗牌轮流出场，循环使用 */
const BOOT_LINES = [
  "唤醒 JVM 巨龙…",
  "给 AI 倒杯咖啡…",
  "整理比特与字节…",
  "热身 AES 加密引擎…",
  "检查 8091 号跑道…",
  "装载运维魔法书…",
  "和本地服务握个手…",
  "校准终端光标…",
  "教 AI 背诵 man 手册…",
  "擦亮 SSH 隧道…",
];

/** 等待过久的安抚文案：按出现时间依次插队一次，不参与随机 */
const SLOW_HINTS: Array<{ afterMs: number; text: string }> = [
  { afterMs: 15_000, text: "低配机上首次启动会慢一些，再陪它等等…" },
  { afterMs: 30_000, text: "仍在等待后端服务响应…" },
  { afterMs: 45_000, text: "快超时了，一直卡着的话待会儿可以重试或改地址…" },
];

const TICK_MS = 40;
const VISIBLE_LINES = 3;

/** Tauri 桌面壳检测：纯浏览器 dev 下为 false，跳过所有 Tauri API 调用 */
const isTauri = () => "__TAURI_INTERNALS__" in window;

interface LogLine {
  id: number;
  /** 当前已显示部分（打字机推进中） */
  text: string;
  full: string;
  done: boolean;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Mood = "thinking" | "happy" | "dead";

/** 几何小吉祥物：等待时漂浮眨眼，就绪眯眼笑，失败翻白眼（✕✕） */
function Mascot({ mood }: { mood: Mood }) {
  const moodClass =
    mood === "happy"
      ? styles.moodHappy
      : mood === "dead"
        ? styles.moodDead
        : "";
  return (
    <div className={`${styles.mascot} ${moodClass}`}>
      <div className={styles.halo} />
      <div className={styles.mascotBody}>
        <div className={styles.eyes}>
          <span className={styles.eye} />
          <span className={styles.eye} />
        </div>
        <div className={styles.mouth} />
      </div>
      <div className={styles.mascotShadow} />
    </div>
  );
}

/**
 * 启动遮罩（一次性启动门）。
 *
 * bootPhase 为 done 之前由本组件全屏接管：等待态展示吉祥物 + 打字机日志 +
 * 历史时长预估进度条；失败态提供自救三件套（重试 / 修改后端地址 / 日志线索）。
 * 决议见 docs/situations/260722-boot-splash-and-startup-speed.md Q1/Q3/Q5。
 */
export default function BootSplash() {
  const bootPhase = useBackendStore((s) => s.bootPhase);
  const readyStatus = useBackendStore((s) => s.readyStatus);
  const readyMessage = useBackendStore((s) => s.readyMessage);
  const boot = useBackendStore((s) => s.boot);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const failed = bootPhase === "failed";
  // 冲刺窗口：后端已就绪、boot() 正在等冲刺计时——进度冲 100%，吉祥物开心
  const sprinting = readyStatus === "ready" && bootPhase === "booting";
  const mood: Mood = failed ? "dead" : sprinting ? "happy" : "thinking";

  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    []
  );
  const expectedMs = useMemo(() => readExpectedBootMs(), []);

  const startRef = useRef(Date.now());
  const [progress, setProgress] = useState(0);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logDir, setLogDir] = useState<string | null>(null);
  const schedRef = useRef({
    queue: shuffle(BOOT_LINES),
    hintIdx: 0,
    pauseTicks: 0,
    nextId: 1,
  });

  // Rust 失败快报：spawn 失败事件让遮罩秒转失败态，不傻等 60s ping 超时。
  // 先订阅事件再补查一次暂存值（setup 失败早于 webview 就绪时事件会错过）。
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
      ]);
      const un = await listen<string>("backend-launch-failed", (e) => {
        useBackendStore.getState().markBootFailed(e.payload);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      const failure = await invoke<string | null>("backend_launch_failure");
      if (!cancelled && failure) {
        useBackendStore.getState().markBootFailed(failure);
      }
      const dir = await invoke<string>("backend_log_dir");
      if (!cancelled) setLogDir(dir);
    })().catch(() => {
      // Tauri API 不可用（异常降级）：保持纯 ping 轮询路径，超时兜底仍有效
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 失败页点重试：failed → booting 时重置计时、进度与日志，重新开演
  const prevPhaseRef = useRef(bootPhase);
  useEffect(() => {
    if (prevPhaseRef.current === "failed" && bootPhase === "booting") {
      startRef.current = Date.now();
      setProgress(0);
      setLogLines([]);
      schedRef.current = {
        queue: shuffle(BOOT_LINES),
        hintIdx: 0,
        pauseTicks: 0,
        nextId: schedRef.current.nextId,
      };
    }
    prevPhaseRef.current = bootPhase;
  }, [bootPhase]);

  // 预估进度：200ms 步进 + CSS transition 插值平滑
  useEffect(() => {
    if (failed || sprinting) return;
    const id = setInterval(() => {
      setProgress(estimateProgress(Date.now() - startRef.current, expectedMs));
    }, 200);
    return () => clearInterval(id);
  }, [failed, sprinting, expectedMs]);

  // 打字机日志状态机：推进当前行 → 行间停顿 → 取下一条（安抚文案到点插队）
  useEffect(() => {
    if (failed || sprinting) return;
    const id = setInterval(() => {
      const sched = schedRef.current;
      setLogLines((lines) => {
        const last = lines[lines.length - 1];
        if (last && !last.done) {
          const nextLen = prefersReducedMotion
            ? last.full.length
            : last.text.length + 1;
          const text = last.full.slice(0, nextLen);
          const done = nextLen >= last.full.length;
          if (done) sched.pauseTicks = 20 + Math.floor(Math.random() * 10);
          return [...lines.slice(0, -1), { ...last, text, done }];
        }
        if (sched.pauseTicks > 0) {
          sched.pauseTicks--;
          return lines;
        }
        const elapsed = Date.now() - startRef.current;
        const hint = SLOW_HINTS[sched.hintIdx];
        let full: string;
        if (hint && elapsed >= hint.afterMs) {
          sched.hintIdx++;
          full = hint.text;
        } else {
          if (sched.queue.length === 0) sched.queue = shuffle(BOOT_LINES);
          full = sched.queue.shift() as string;
        }
        const line: LogLine = { id: sched.nextId++, text: "", full, done: false };
        return [...lines, line].slice(-VISIBLE_LINES);
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [failed, sprinting, prefersReducedMotion]);

  const shownProgress = sprinting ? 1 : progress;

  return (
    <div className={styles.splash}>
      <div className={styles.stage}>
        <Mascot mood={mood} />

        {failed ? (
          <div className={styles.failBox}>
            <div className={styles.failTitle}>后端服务未能启动</div>
            <div className={styles.failMessage}>
              {readyMessage ?? "等待本地服务就绪超时"}
            </div>
            {logDir && (
              <div className={styles.failHint}>日志目录：{logDir}</div>
            )}
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
          <>
            <div className={styles.log} aria-live="polite">
              {logLines.map((l) => (
                <div key={l.id} className={styles.logLine}>
                  <span className={styles.logPrompt}>$</span>
                  <span className={styles.logText}>{l.text}</span>
                  {l.done ? (
                    <span className={styles.logOk}>ok</span>
                  ) : (
                    <span className={styles.caret} />
                  )}
                </div>
              ))}
              {sprinting && (
                <div className={styles.logLine}>
                  <span className={styles.logPrompt}>$</span>
                  <span className={styles.logReady}>就绪！</span>
                </div>
              )}
            </div>

            <div className={styles.progressRow}>
              <div className={styles.progressTrack}>
                <div
                  className={`${styles.progressFill} ${sprinting ? styles.progressSprint : ""}`}
                  style={{ transform: `scaleX(${shownProgress})` }}
                />
              </div>
              <span className={styles.progressLabel}>
                {Math.round(shownProgress * 100)}%
              </span>
            </div>
          </>
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
