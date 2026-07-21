package com.johnny.domain.ssh.service;

/**
 * 服务器监控采样（C1）：采集命令与输出解析同源在本类，采样格式变化只改这里。
 *
 * <p>设计取舍：CPU 使用率需要两次采样差分（/proc/stat 是开机累计值），差分放前端
 * （轮询本就在前端，后端保持无状态）；本类只把原始输出转成结构化累计值/即时值。
 * 单段解析失败置 null 不整体报错——监控是辅助信息，一项缺失不该让其余三项跟着消失。
 */
public final class ServerMetricsParser {

    /** 复合轻命令：一次 exec 采 CPU 累计值 + 内存 + 负载 + 核数（约 10s 一轮） */
    public static final String SAMPLE_COMMAND =
            "head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; cat /proc/loadavg; nproc";

    /** 磁盘段后缀（根分区使用率；变化慢，前端 300s 才附带一次） */
    public static final String DISK_COMMAND_SUFFIX = "; df -P / | tail -1";

    /** 解析结果值对象（public 字段，对齐服务契约 Cmd POJO 风格）；字段 null=该段解析失败/缺失 */
    public static class ServerMetrics {
        /** /proc/stat 首行全部 jiffies 之和（开机累计，前端差分用） */
        public Long cpuTotalJiffies;
        /** idle + iowait 累计 jiffies */
        public Long cpuIdleJiffies;
        public Long memTotalBytes;
        public Long memAvailableBytes;
        /** 1 分钟平均负载 */
        public Double load1;
        public Integer cpuCores;
        /** 根分区已用百分比（0-100）；未采磁盘段时为 null */
        public Integer diskUsedPercent;
    }

    private ServerMetricsParser() {
    }

    /**
     * 按行特征识别解析（不依赖行号顺序，个别段缺失/报错不影响其余段）。
     */
    public static ServerMetrics parse(String output) {
        ServerMetrics m = new ServerMetrics();
        if (output == null || output.isBlank()) {
            return m;
        }
        for (String raw : output.split("\r?\n")) {
            String line = raw.trim();
            if (line.isEmpty()) {
                continue;
            }
            try {
                if (line.startsWith("cpu ")) {
                    parseCpuLine(line, m);
                } else if (line.startsWith("MemTotal:")) {
                    m.memTotalBytes = parseMeminfoKb(line);
                } else if (line.startsWith("MemAvailable:")) {
                    m.memAvailableBytes = parseMeminfoKb(line);
                } else if (isLoadavgLine(line)) {
                    m.load1 = Double.parseDouble(line.split("\\s+")[0]);
                } else if (line.matches("\\d+")) {
                    // nproc：整行只有一个整数
                    m.cpuCores = Integer.parseInt(line);
                } else if (line.contains("%")) {
                    m.diskUsedPercent = parseDfUsePercent(line);
                }
            } catch (Exception ignore) {
                // 单段解析失败留 null，其余段继续（容错立场见类注释）
            }
        }
        return m;
    }

    /** 「cpu  user nice system idle iowait ...」：total=全字段和，idle=idle+iowait */
    private static void parseCpuLine(String line, ServerMetrics m) {
        String[] fields = line.split("\\s+");
        long total = 0;
        for (int i = 1; i < fields.length; i++) {
            total += Long.parseLong(fields[i]);
        }
        // fields[4]=idle，fields[5]=iowait（iowait 期间 CPU 同样空闲）
        long idle = Long.parseLong(fields[4]) + (fields.length > 5 ? Long.parseLong(fields[5]) : 0);
        m.cpuTotalJiffies = total;
        m.cpuIdleJiffies = idle;
    }

    /** 「MemTotal:        3880012 kB」→ bytes */
    private static Long parseMeminfoKb(String line) {
        String[] fields = line.split("\\s+");
        return Long.parseLong(fields[1]) * 1024;
    }

    /** loadavg 行特征：5 段且第 4 段形如「running/total」 */
    private static boolean isLoadavgLine(String line) {
        String[] fields = line.split("\\s+");
        return fields.length == 5 && fields[3].contains("/") && !line.startsWith("/");
    }

    /** df -P 数据行：取带 % 的字段去掉百分号 */
    private static Integer parseDfUsePercent(String line) {
        for (String field : line.split("\\s+")) {
            if (field.endsWith("%")) {
                return Integer.parseInt(field.substring(0, field.length() - 1));
            }
        }
        return null;
    }
}
