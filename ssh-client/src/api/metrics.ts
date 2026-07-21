/**
 * 激活服务器监控采样（C1 监控条）对接。
 */
import { http } from "./request";

/** 服务端采样响应；字段 null=该段采集/解析失败，前端显示占位符即可 */
export interface ServerMetricsDTO {
  /** /proc/stat 开机累计 jiffies（CPU 使用率需两次采样差分，前端持有上次快照） */
  cpuTotalJiffies: number | null;
  cpuIdleJiffies: number | null;
  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  load1: number | null;
  cpuCores: number | null;
  /** 根分区已用百分比；仅 includeDisk=true 的采样返回 */
  diskUsedPercent: number | null;
}

/** 采一轮指标；includeDisk 的 300s 节奏由调用方控制 */
export function getServerMetrics(
  connectionId: string,
  includeDisk: boolean
): Promise<ServerMetricsDTO> {
  return http.get<ServerMetricsDTO>(
    `/api/ssh/connections/${connectionId}/metrics?disk=${includeDisk}`
  );
}
