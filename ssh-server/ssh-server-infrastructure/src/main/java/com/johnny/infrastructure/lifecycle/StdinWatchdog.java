package com.johnny.infrastructure.lifecycle;

import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;

/**
 * stdin 哨兵：桌面壳（Tauri）以管道接管本进程 stdin 后，壳进程一旦消亡
 * （正常退出主动关闭写端，或崩溃/被杀由 OS 关闭管道），本端读到 EOF，
 * 即刻触发 {@link System#exit(int)} 走 shutdown hook 优雅落盘退出。
 * 这是 macOS 上防孤儿的主力、Windows 上 Job Object 之外的双保险，
 * 同时承担正常关窗的优雅关闭信道（两种 EOF 走同一条路径）。
 *
 * <p>必须通过 -D{@value #ENABLE_PROPERTY}=true 显式启用——独立脚本
 * {@code java -jar ... < /dev/null} 起服务时 stdin 开局即 EOF，无开关会秒退。
 */
@Slf4j
public final class StdinWatchdog {

    public static final String ENABLE_PROPERTY = "lifecycle.stdin-watch";

    private StdinWatchdog() {
    }

    /**
     * 开关开启时挂载哨兵到真实 stdin，EOF 即退出 JVM。
     *
     * @return 哨兵线程；开关未开返回 null
     */
    public static Thread startIfEnabled() {
        if (!Boolean.getBoolean(ENABLE_PROPERTY)) {
            return null;
        }
        return watch(System.in, () -> {
            log.info("stdin EOF：宿主进程已退出或主动关闭管道，开始优雅停机");
            System.exit(0);
        });
    }

    static Thread watch(InputStream in, Runnable onEof) {
        Thread thread = new Thread(() -> {
            try {
                byte[] discard = new byte[64];
                while (in.read(discard) != -1) {
                    // 宿主不会写入数据；读到的内容一律丢弃，只等 EOF
                }
            } catch (IOException e) {
                // 读异常与 EOF 同义：管道已断，宿主必然不在了
            }
            onEof.run();
        }, "stdin-watchdog");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }
}
