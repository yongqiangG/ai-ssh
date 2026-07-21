package com.johnny.domain.ssh.service;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

/**
 * 监控采样输出解析测试：真实样本全解析、缺段容错、垃圾输入不抛异常。
 */
public class ServerMetricsParserTest {

    /** SAMPLE_COMMAND（含磁盘后缀）在典型 Linux 上的真实形态输出 */
    private static final String FULL_OUTPUT = String.join("\n",
            "cpu  191964 231 76829 4364461 4642 0 2113 0 0 0",
            "MemTotal:        3880012 kB",
            "MemAvailable:    2456788 kB",
            "0.52 0.58 0.59 1/389 12345",
            "2",
            "/dev/vda1       41152812 12097224  27151160  31% /"
    );

    @Test
    public void parses_full_sample() {
        ServerMetricsParser.ServerMetrics m = ServerMetricsParser.parse(FULL_OUTPUT);
        // total = 全数值字段之和；idle = idle + iowait
        assertEquals(Long.valueOf(191964L + 231 + 76829 + 4364461 + 4642 + 2113), m.cpuTotalJiffies);
        assertEquals(Long.valueOf(4364461L + 4642), m.cpuIdleJiffies);
        assertEquals(Long.valueOf(3880012L * 1024), m.memTotalBytes);
        assertEquals(Long.valueOf(2456788L * 1024), m.memAvailableBytes);
        assertEquals(Double.valueOf(0.52), m.load1);
        assertEquals(Integer.valueOf(2), m.cpuCores);
        assertEquals(Integer.valueOf(31), m.diskUsedPercent);
    }

    @Test
    public void no_disk_section_leaves_disk_null() {
        String withoutDisk = FULL_OUTPUT.substring(0, FULL_OUTPUT.lastIndexOf('\n'));
        ServerMetricsParser.ServerMetrics m = ServerMetricsParser.parse(withoutDisk);
        assertNull(m.diskUsedPercent);
        assertEquals(Integer.valueOf(2), m.cpuCores);
        assertEquals(Double.valueOf(0.52), m.load1);
    }

    @Test
    public void missing_mem_available_only_nulls_that_field() {
        // 老内核（<3.14）无 MemAvailable 行
        String output = String.join("\n",
                "cpu  100 0 100 800 0 0 0 0 0 0",
                "MemTotal:        1024000 kB",
                "0.10 0.20 0.30 1/100 999",
                "4"
        );
        ServerMetricsParser.ServerMetrics m = ServerMetricsParser.parse(output);
        assertEquals(Long.valueOf(1024000L * 1024), m.memTotalBytes);
        assertNull(m.memAvailableBytes);
        assertEquals(Long.valueOf(1000L), m.cpuTotalJiffies);
        assertEquals(Integer.valueOf(4), m.cpuCores);
    }

    @Test
    public void garbage_or_empty_input_returns_all_null_without_throwing() {
        ServerMetricsParser.ServerMetrics empty = ServerMetricsParser.parse("");
        assertNull(empty.cpuTotalJiffies);
        assertNull(empty.memTotalBytes);
        assertNull(empty.load1);
        assertNull(empty.cpuCores);
        assertNull(empty.diskUsedPercent);

        ServerMetricsParser.ServerMetrics garbage =
                ServerMetricsParser.parse("bash: head: command not found\nsome noise");
        assertNull(garbage.cpuTotalJiffies);
        assertNull(garbage.diskUsedPercent);
    }

    @Test
    public void cpu0_line_is_not_mistaken_for_aggregate() {
        // 只认聚合行「cpu 」，不认 per-core 的「cpu0」
        ServerMetricsParser.ServerMetrics m =
                ServerMetricsParser.parse("cpu0 100 0 100 800 0 0 0 0 0 0");
        assertNull(m.cpuTotalJiffies);
    }
}
