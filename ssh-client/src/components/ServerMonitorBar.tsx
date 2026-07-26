/**
 * 激活服务器监控条（C1）：连接列表下方常驻，四项 CPU/内存/负载/磁盘。
 *
 * ## 采样节奏（决议）
 * 只采当前激活连接（terminalStore.activeId）；CPU/内存/负载 10s 一轮，磁盘每 30 轮
 * （300s）附带一次；首轮带磁盘立即采，并在 1.5s 后补采一次让 CPU 差分尽快出值
 * （否则首个 CPU 数字要等第二轮 10s 后才有）。
 *
 * ## 为什么不建 store
 * 指标只有本组件一个消费者，差分快照/磁盘缓存用 ref 即可；组件卸载轮询即停，
 * 生命周期与显示天然一致（对齐 TerminalPanel 心跳的组件内 interval 模式）。
 */
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { getServerMetrics } from "../api/metrics";
import type { ServerMetricsDTO } from "../api/metrics";
import { useConnectionStore } from "../stores/connectionStore";
import { useTerminalStore } from "../stores/terminalStore";
import styles from "./ServerMonitorBar.module.css";

/** CPU/内存/负载采样间隔 */
const POLL_MS = 10_000;
/** 磁盘附带节奏：每 N 轮带一次（N×POLL_MS=300s） */
const DISK_EVERY_ROUNDS = 30;

interface Display {
  cpuPercent: number | null;
  memPercent: number | null;
  load1: number | null;
  cpuCores: number | null;
  diskPercent: number | null;
}

const EMPTY_DISPLAY: Display = {
  cpuPercent: null,
  memPercent: null,
  load1: null,
  cpuCores: null,
  diskPercent: null,
};

export default function ServerMonitorBar() {
  const activeId = useTerminalStore((s) => s.activeId);
  const connections = useConnectionStore((s) => s.connections);
  const active = activeId
    ? connections.find((c) => c.connectionId === activeId) ?? null
    : null;
  const connected = active?.status === "connected";

  const [display, setDisplay] = useState<Display>(EMPTY_DISPLAY);
  /** 上一轮 CPU 累计值快照（差分分母）；连接切换时重置 */
  const cpuPrevRef = useRef<{ total: number; idle: number } | null>(null);
  /** 最近一次磁盘值（非磁盘轮沿用显示，300s 才刷新） */
  const diskRef = useRef<number | null>(null);

  useEffect(() => {
    // 切换/断开：清空显示与差分基线
    cpuPrevRef.current = null;
    diskRef.current = null;
    setDisplay(EMPTY_DISPLAY);
    if (!activeId || !connected) return;

    let cancelled = false;

    const tick = async (withDisk: boolean) => {
      let m: ServerMetricsDTO;
      try {
        m = await getServerMetrics(activeId, withDisk);
      } catch {
        // 瞬时采样失败保留旧值不闪动；连接真断开由 connectionStore 心跳翻状态走空态
        return;
      }
      if (cancelled) return;

      // CPU：与上轮累计值差分；首轮无基线显示 --
      let cpuPercent: number | null = null;
      if (m.cpuTotalJiffies != null && m.cpuIdleJiffies != null) {
        const prev = cpuPrevRef.current;
        if (prev && m.cpuTotalJiffies > prev.total) {
          const dTotal = m.cpuTotalJiffies - prev.total;
          const dIdle = m.cpuIdleJiffies - prev.idle;
          cpuPercent = Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100));
        }
        cpuPrevRef.current = { total: m.cpuTotalJiffies, idle: m.cpuIdleJiffies };
      }

      if (m.diskUsedPercent != null) diskRef.current = m.diskUsedPercent;

      setDisplay((d) => ({
        cpuPercent: cpuPercent ?? d.cpuPercent,
        memPercent:
          m.memTotalBytes != null && m.memAvailableBytes != null && m.memTotalBytes > 0
            ? (1 - m.memAvailableBytes / m.memTotalBytes) * 100
            : null,
        load1: m.load1,
        cpuCores: m.cpuCores,
        diskPercent: diskRef.current,
      }));
    };

    // 首轮带磁盘立即采；1.5s 后补采一次让 CPU 差分尽快出值
    void tick(true).then(() => {
      if (!cancelled) window.setTimeout(() => void tick(false), 1500);
    });
    let round = 0;
    const timer = window.setInterval(() => {
      round += 1;
      void tick(round % DISK_EVERY_ROUNDS === 0);
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId, connected]);

  return (
    <div className={styles.bar}>
      <div className={styles.head}>
        <Icon name="server" size={11} />
        <span className={styles.title}>服务器监控</span>
        {connected && active && <span className={styles.host}>{active.name}</span>}
      </div>
      {!connected ? (
        <div className={styles.empty}>连接服务器后显示实时指标</div>
      ) : (
        <div className={styles.grid}>
          <MetricItem
            label="CPU"
            value={fmtPercent(display.cpuPercent)}
            tone="none"
            percent={display.cpuPercent}
          />
          <MetricItem
            label="内存"
            value={fmtPercent(display.memPercent)}
            tone={toneOf(display.memPercent, { red: 90 })}
            percent={display.memPercent}
          />
          <MetricItem
            label="负载"
            value={display.load1 != null ? display.load1.toFixed(2) : "--"}
            tone={
              display.load1 != null &&
              display.cpuCores != null &&
              display.load1 > display.cpuCores * 2
                ? "red"
                : "none"
            }
          />
          <MetricItem
            label="磁盘"
            value={fmtPercent(display.diskPercent)}
            tone={toneOf(display.diskPercent, { red: 95, yellow: 85 })}
            percent={display.diskPercent}
          />
        </div>
      )}
    </div>
  );
}

type Tone = "none" | "yellow" | "red";

function fmtPercent(v: number | null): string {
  return v != null ? `${Math.round(v)}%` : "--";
}

/** 阈值着色（决议）：超 red 红、超 yellow 黄（未配黄阈的项只有红档） */
function toneOf(v: number | null, t: { red: number; yellow?: number }): Tone {
  if (v == null) return "none";
  if (v > t.red) return "red";
  if (t.yellow != null && v > t.yellow) return "yellow";
  return "none";
}

function MetricItem({
  label,
  value,
  tone,
  percent,
}: {
  label: string;
  value: string;
  tone: Tone;
  /** 0-100 电量刻度；无天然百分比标度的指标（负载）不传、不画仪表 */
  percent?: number | null;
}) {
  const toneClass =
    tone === "red" ? styles.red : tone === "yellow" ? styles.yellow : "";
  return (
    <div className={styles.item}>
      <div className={styles.itemRow}>
        <span className={styles.label}>{label}</span>
        <span className={`${styles.value} ${toneClass}`}>{value}</span>
      </div>
      {percent != null && (
        <div className={styles.meterTrack} aria-hidden>
          <div
            className={`${styles.meterFill} ${toneClass}`}
            style={{ transform: `scaleX(${Math.min(100, Math.max(0, percent)) / 100})` }}
          />
        </div>
      )}
    </div>
  );
}
