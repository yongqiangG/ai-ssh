package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.Session;
import com.johnny.domain.ssh.adapter.port.ITerminalSessionPort;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 终端会话端口实现；基于 JSch ChannelShell 提供交互式 shell 通道。
 * <p>
 * 每个终端会话对应一个 {@link ChannelShell}：
 * <ul>
 *   <li>写入：直接写通道标准输入（stdin）并 flush；</li>
 *   <li>输出：后台守护线程持续从通道 InputStream 读取，append 到 {@link StringBuilder}
 *       缓冲区，前端轮询经 {@link #drain} 一次性取走——读线程与 HTTP 线程以缓冲区对象为锁同步；</li>
 *   <li>解码：读取经 {@link InputStreamReader}（UTF-8），由 Reader 处理多字节字符的
 *       读取边界，避免中文等宽字符被从中间截断产生乱码。</li>
 * </ul>
 * shell 通道打开在 {@link SshSessionPort} 维护的 JSch {@link Session} 之上，
 * 因此依赖其具体类（同层协作），而非领域端口接口。
 */
@Slf4j
@Component
public class TerminalSessionPort implements ITerminalSessionPort {

    /** shell 通道连接超时（毫秒） */
    private static final int CHANNEL_CONNECT_TIMEOUT = 5000;

    /** 读线程单次读取缓冲大小（字符） */
    private static final int READ_BUF_SIZE = 4096;

    private final SshSessionPort sshSessionPort;

    /** sessionId -> shell 通道上下文 */
    private final Map<String, ShellChannel> channels = new ConcurrentHashMap<>();

    public TerminalSessionPort(SshSessionPort sshSessionPort) {
        this.sshSessionPort = sshSessionPort;
    }

    @Override
    public void open(String sessionId, String connectionId, int cols, int rows) {
        Session session = sshSessionPort.getSession(connectionId);
        if (session == null || !session.isConnected()) {
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "SSH 未连接，无法打开终端 connectionId=" + connectionId);
        }
        // 同 sessionId 残留的旧通道先清理（正常流程不会发生，防御性兜底）
        close(sessionId);
        try {
            ChannelShell channel = (ChannelShell) session.openChannel("shell");
            // 分配伪终端并声明初始窗口尺寸，远端按交互式 shell 处理（回显、补全、ANSI 颜色）
            channel.setPtyType("xterm", cols, rows, 0, 0);
            // 输入输出流须在 connect 前取好
            InputStream stdout = channel.getInputStream();
            OutputStream stdin = channel.getOutputStream();
            channel.connect(CHANNEL_CONNECT_TIMEOUT);

            ShellChannel sc = new ShellChannel(channel, stdin);
            channels.put(sessionId, sc);
            Thread reader = new Thread(() -> readLoop(sessionId, sc, stdout),
                    "terminal-reader-" + sessionId);
            reader.setDaemon(true);
            reader.start();
            log.info("终端 shell 通道已打开 sessionId={} connectionId={} pty={}x{}",
                    sessionId, connectionId, cols, rows);
        } catch (Exception e) {
            log.error("终端 shell 通道打开失败 sessionId={} connectionId={}", sessionId, connectionId, e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "终端打开失败：" + e.getMessage(), e);
        }
    }

    /**
     * 后台读取循环：阻塞读 shell 输出并追加到缓冲区，直到流关闭（远端退出/通道断开）。
     * 异常与 EOF 均标记 closed，供 {@link #isOpen} 与领域服务感知断联。
     */
    private void readLoop(String sessionId, ShellChannel sc, InputStream stdout) {
        try (Reader reader = new InputStreamReader(stdout, StandardCharsets.UTF_8)) {
            char[] buf = new char[READ_BUF_SIZE];
            int n;
            while ((n = reader.read(buf)) != -1) {
                synchronized (sc.buffer) {
                    sc.buffer.append(buf, 0, n);
                }
            }
            log.info("终端输出流已结束（远端关闭）sessionId={}", sessionId);
        } catch (IOException e) {
            // 主动 close 会关闭底层流使 read 抛异常，属预期路径；其余情况记录告警
            if (!sc.closed) {
                log.warn("终端输出读取异常 sessionId={} reason={}", sessionId, e.getMessage());
            }
        } finally {
            sc.closed = true;
        }
    }

    @Override
    public void write(String sessionId, String data) {
        ShellChannel sc = requireChannel(sessionId);
        try {
            // 用户键入与 AI 整行命令可能并发写入，JSch 输出流非线程安全，串行化防字节交错
            synchronized (sc.stdin) {
                sc.stdin.write(data.getBytes(StandardCharsets.UTF_8));
                sc.stdin.flush();
            }
        } catch (IOException e) {
            log.error("终端写入失败 sessionId={}", sessionId, e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "终端写入失败：" + e.getMessage(), e);
        }
    }

    @Override
    public String drain(String sessionId) {
        ShellChannel sc = channels.get(sessionId);
        if (sc == null) {
            return "";
        }
        synchronized (sc.buffer) {
            if (sc.buffer.length() == 0) {
                return "";
            }
            String content = sc.buffer.toString();
            sc.buffer.setLength(0);
            return content;
        }
    }

    @Override
    public boolean isOpen(String sessionId) {
        ShellChannel sc = channels.get(sessionId);
        return sc != null && !sc.closed && sc.channel.isConnected() && !sc.channel.isClosed();
    }

    @Override
    public void resize(String sessionId, int cols, int rows) {
        ShellChannel sc = requireChannel(sessionId);
        sc.channel.setPtySize(cols, rows, 0, 0);
    }

    @Override
    public void close(String sessionId) {
        ShellChannel sc = channels.remove(sessionId);
        if (sc == null) {
            return;
        }
        sc.closed = true;
        // 断开通道会关闭底层流，读线程随之退出
        sc.channel.disconnect();
        log.info("终端 shell 通道已关闭 sessionId={}", sessionId);
    }

    private ShellChannel requireChannel(String sessionId) {
        ShellChannel sc = channels.get(sessionId);
        if (sc == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "终端会话不存在 sessionId=" + sessionId);
        }
        return sc;
    }

    /** 单个 shell 通道的运行时上下文 */
    private static final class ShellChannel {
        final ChannelShell channel;
        final OutputStream stdin;
        /** 输出缓冲；读线程 append、HTTP 线程 drain，以其自身为锁同步 */
        final StringBuilder buffer = new StringBuilder();
        /** 通道已关闭标记（读线程 EOF/异常或主动 close 置位） */
        volatile boolean closed;

        ShellChannel(ChannelShell channel, OutputStream stdin) {
            this.channel = channel;
            this.stdin = stdin;
        }
    }
}
