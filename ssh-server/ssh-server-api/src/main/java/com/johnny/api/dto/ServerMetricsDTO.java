package com.johnny.api.dto;

import lombok.Data;

/**
 * 激活服务器监控采样响应（C1 监控条）。
 *
 * <p>CPU 两项是开机累计 jiffies——使用率需两次采样差分，由前端持有上次快照计算
 * （cpu% = 1 - Δidle/Δtotal），后端保持无状态。字段为 null 表示该段采集/解析失败，
 * 前端显示占位符即可，不影响其余项。
 */
@Data
public class ServerMetricsDTO {

    /** /proc/stat 首行全部 jiffies 之和（开机累计） */
    private Long cpuTotalJiffies;

    /** idle + iowait 累计 jiffies */
    private Long cpuIdleJiffies;

    private Long memTotalBytes;

    private Long memAvailableBytes;

    /** 1 分钟平均负载 */
    private Double load1;

    /** CPU 核数（load 阈值着色的分母） */
    private Integer cpuCores;

    /** 根分区已用百分比 0-100（仅 disk=true 的采样返回；磁盘变化慢，前端 300s 才带一次） */
    private Integer diskUsedPercent;
}
