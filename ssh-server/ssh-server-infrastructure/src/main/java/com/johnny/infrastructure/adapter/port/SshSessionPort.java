package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.johnny.domain.ssh.adapter.port.ConnectParams;
import com.johnny.domain.ssh.adapter.port.ExecResult;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SSH 会话端口实现；基于 JSch 提供 SSH 客户端的基础能力。
 * <p>
 * 以 connectionId 索引维护多个 SSH 会话（{@link ConcurrentHashMap}）；单个会话仍非线程安全。
 */
@Slf4j
@Component
public class SshSessionPort implements ISshSessionPort {

    /** 连接超时时间（毫秒），避免不可达主机导致长时间阻塞 */
    private static final int CONNECT_TIMEOUT = 5000;

    /** 单条命令执行的最大等待时间（毫秒），避免命令卡死阻塞调用线程（旧 exec(String) 用） */
    private static final int EXEC_TIMEOUT = 10000;

    /** exec 通道单流（stdout/stderr 各自）最大保留字节，超出截断（Q4：约 2000+ token） */
    private static final int EXEC_STREAM_LIMIT = 8 * 1024;

    /** 终端退出/命令轮询间隔（毫秒） */
    private static final int POLL_INTERVAL = 50;

    /** connectionId -> SSH 会话 */
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    @Override
    public boolean connect(String connectionId, ConnectParams params) {
        disconnect(connectionId);
        try {
            JSch jsch = new JSch();
            // 提供私钥时优先使用公钥认证；passphrase 为 null 时按无口令私钥处理
            boolean useKey = params.privateKey != null && !params.privateKey.isEmpty();
            if (useKey) {
                byte[] passphraseBytes = (params.passphrase == null || params.passphrase.isEmpty())
                        ? null : params.passphrase.getBytes(StandardCharsets.UTF_8);
                jsch.addIdentity(connectionId, params.privateKey.getBytes(StandardCharsets.UTF_8), null, passphraseBytes);
            }
            Session newSession = jsch.getSession(params.username, params.host, params.port);
            if (!useKey) {
                newSession.setPassword(params.password);
            }
            // TODO(迭代 A-4)：TOFU——strictHostKeyCheck=true 时挂自定义 HostKeyRepository 按 knownHosts 校验；
            // 当前阶段保持跳过校验（与既有行为一致），字段已透传到位。
            newSession.setConfig("StrictHostKeyChecking", "no");
            if (params.compression) {
                newSession.setConfig("compression.s2c", "zlib@openssh.com,zlib,none");
                newSession.setConfig("compression.c2s", "zlib@openssh.com,zlib,none");
            }
            if (params.keepaliveInterval != null && params.keepaliveInterval > 0) {
                // 周期向服务端发 keepalive 包，防 NAT/防火墙静默断连
                newSession.setServerAliveInterval(params.keepaliveInterval);
            }
            int connectTimeout = (params.connectTimeout != null && params.connectTimeout > 0)
                    ? params.connectTimeout : CONNECT_TIMEOUT;
            newSession.connect(connectTimeout);
            sessions.put(connectionId, newSession);
            log.info("SSH 连接成功 connectionId={} host={} port={} username={} auth={} timeout={} keepalive={} compression={}",
                    connectionId, params.host, params.port, params.username, useKey ? "key" : "password",
                    connectTimeout, params.keepaliveInterval, params.compression);
            // 连接成功后立即执行一次 pwd 探测，便于在日志中看到远端真实反馈；
            // 直接复用本类 exec（此时 session 已入表）。不要调 sshConnectionService——
            // 它是 domain 层服务，反向依赖会构成 SshConnectionService ↔ SshSessionPort 循环。
            try {
                exec(connectionId, "pwd");
            } catch (Exception execEx) {
                // 探测失败不改变连接结果（SSH 连接已成功建立）；详细堆栈已由 exec 内部记录
                log.warn("SSH 连接成功但探测命令 pwd 失败（不影响连接）connectionId={} reason={}",
                        connectionId, execEx.getMessage());
            }
            return true;
        } catch (Exception e) {
            log.error("SSH 连接失败 connectionId={} host={} port={} username={}",
                    connectionId, params.host, params.port, params.username, e);
            return false;
        }
    }

    @Override
    public void disconnect(String connectionId) {
        Session session = sessions.remove(connectionId);
        if (session != null) {
            if (session.isConnected()) {
                session.disconnect();
            }
            log.info("SSH 连接已断开 connectionId={}", connectionId);
        }
    }

    @Override
    public boolean isConnected(String connectionId) {
        Session session = sessions.get(connectionId);
        return session != null && session.isConnected();
    }

    /**
     * 获取底层 JSch 会话，供同层 {@link TerminalSessionPort} 在其上打开 shell 通道。
     * <p>
     * 仅基础设施层内部使用，不进领域端口接口（JSch 类型不能泄漏到 domain）。
     *
     * @return 对应会话；不存在返回 null
     */
    public Session getSession(String connectionId) {
        return sessions.get(connectionId);
    }

    @Override
    public void openShell(String connectionId, InputStream in, OutputStream out) {
        Session session = sessions.get(connectionId);
        if (session == null || !session.isConnected()) {
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "SSH 未连接，无法打开终端 connectionId=" + connectionId);
        }
        ChannelShell channel = null;
        try {
            channel = (ChannelShell) session.openChannel("shell");
            // 分配伪终端，使远端按交互式 shell 处理（支持回显、Tab 补全、信号等）
            channel.setPtyType("xterm");
            channel.setInputStream(in);
            channel.setOutputStream(out);
            channel.setExtOutputStream(out);
            channel.connect();
            log.info("SSH 交互式终端已开启 connectionId={}，输入 exit 退出", connectionId);
            // 阻塞直到 shell 关闭
            while (!channel.isClosed()) {
                Thread.sleep(POLL_INTERVAL);
            }
            log.info("SSH 交互式终端已退出 connectionId={}", connectionId);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "SSH 终端被中断", ie);
        } catch (Exception e) {
            log.error("SSH 终端异常 connectionId={}", connectionId, e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "SSH 终端异常：" + e.getMessage(), e);
        } finally {
            if (channel != null) {
                channel.disconnect();
            }
        }
    }

    @Override
    public String exec(String connectionId, String command) {
        Session session = sessions.get(connectionId);
        if (session == null || !session.isConnected()) {
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "SSH 未连接，无法执行命令 connectionId=" + connectionId);
        }
        ChannelExec channel = null;
        try {
            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);
            InputStream in = channel.getInputStream();
            channel.connect(CONNECT_TIMEOUT);

            // 阻塞读取命令输出，直到通道关闭或超时
            StringBuilder output = new StringBuilder();
            byte[] buf = new byte[1024];
            long deadline = System.currentTimeMillis() + EXEC_TIMEOUT;
            while (true) {
                while (in.available() > 0) {
                    int n = in.read(buf);
                    if (n < 0) {
                        break;
                    }
                    output.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }
                if (channel.isClosed()) {
                    // 通道关闭后再收尾读一次，确保不丢尾部输出
                    while (in.available() > 0) {
                        int n = in.read(buf);
                        if (n < 0) {
                            break;
                        }
                        output.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                    }
                    break;
                }
                if (System.currentTimeMillis() > deadline) {
                    log.warn("SSH 命令执行超时 connectionId={} cmd={}", connectionId, command);
                    break;
                }
                Thread.sleep(POLL_INTERVAL);
            }
            int exitStatus = channel.getExitStatus();
            log.info("SSH 命令执行完成 connectionId={} cmd=[{}] exit={} output=[{}]",
                    connectionId, command, exitStatus, output.toString().trim());
            return output.toString();
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "SSH 命令执行被中断", ie);
        } catch (Exception e) {
            log.error("SSH 命令执行失败 connectionId={} cmd={}", connectionId, command, e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "SSH 命令执行失败：" + e.getMessage(), e);
        } finally {
            if (channel != null) {
                channel.disconnect();
            }
        }
    }

    /**
     * AI 工具专用 exec 通道（Q1）：同一连接上开一次性 ChannelExec，stdout/stderr 分流采集 +
     * 真实退出码 + 超时强断 + 各截断 8KB。不抛异常（连接级失败返回 null，Q3a）。
     */
    @Override
    public ExecResult exec(String connectionId, String command, long timeoutMs) {
        Session session = sessions.get(connectionId);
        if (session == null || !session.isConnected()) {
            // 连接不存在/已断：返回 null，由工具层判空转错误 Map（不抛异常，Q3a）
            return null;
        }
        ExecResult result = new ExecResult();
        ChannelExec channel = null;
        try {
            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);
            // stderr 走扩展流，与 stdout 分开采集（Q4）
            InputStream stdoutStream = channel.getInputStream();
            InputStream stderrStream = channel.getErrStream();
            channel.connect(CONNECT_TIMEOUT);

            ByteArrayOutputStream stdoutBuf = new ByteArrayOutputStream();
            ByteArrayOutputStream stderrBuf = new ByteArrayOutputStream();
            long deadline = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[1024];

            while (true) {
                drainStream(stdoutStream, stdoutBuf, buf, EXEC_STREAM_LIMIT);
                drainStream(stderrStream, stderrBuf, buf, EXEC_STREAM_LIMIT);

                if (channel.isClosed()) {
                    // 通道关闭后再收尾读一次，确保不丢尾部输出
                    drainStream(stdoutStream, stdoutBuf, buf, EXEC_STREAM_LIMIT);
                    drainStream(stderrStream, stderrBuf, buf, EXEC_STREAM_LIMIT);
                    result.exitCode = channel.getExitStatus();
                    break;
                }
                if (System.currentTimeMillis() > deadline) {
                    result.timedOut = true;
                    log.warn("SSH exec 超时强断 connectionId={} cmd=[{}]", connectionId, command);
                    break;
                }
                Thread.sleep(POLL_INTERVAL);
            }

            result.stdout = stdoutBuf.toString(StandardCharsets.UTF_8);
            result.stderr = stderrBuf.toString(StandardCharsets.UTF_8);
            result.stdoutOriginalBytes = stdoutBuf.size();
            result.stderrOriginalBytes = stderrBuf.size();
            result.stdoutTruncated = result.stdoutOriginalBytes > EXEC_STREAM_LIMIT;
            result.stderrTruncated = result.stderrOriginalBytes > EXEC_STREAM_LIMIT;
            log.info("SSH exec 完成 connectionId={} cmd=[{}] exit={} timedOut={} stdoutBytes={} stderrBytes={}",
                    connectionId, command, result.exitCode, result.timedOut,
                    result.stdoutOriginalBytes, result.stderrOriginalBytes);
            return result;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            // 中断也走错误路径：返回带状态的 result（exitCode 保持 -1），由工具层转错误 Map
            result.timedOut = true;
            return result;
        } catch (Exception e) {
            log.error("SSH exec 异常 connectionId={} cmd=[{}]", connectionId, command, e);
            // 通道级异常：exitCode 保持 -1，由工具层转错误 Map（Q3a）
            return result;
        } finally {
            if (channel != null) {
                channel.disconnect();
            }
        }
    }

    /**
     * 把 InputStream 当前可读字节搬进 buffer，超过 maxBytes 后只读丢弃（截断）。
     * 不阻塞：available()<=0 直接返回。
     */
    private void drainStream(InputStream in, ByteArrayOutputStream out, byte[] buf, int maxBytes) throws Exception {
        // 先把允许保留的部分读进 buffer
        while (in.available() > 0 && out.size() < maxBytes) {
            int n = in.read(buf);
            if (n < 0) {
                break;
            }
            int allow = Math.min(n, maxBytes - out.size());
            if (allow > 0) {
                out.write(buf, 0, allow);
            }
        }
        // 超过上限的剩余字节读出丢弃（清空通道缓冲，避免残留阻塞）
        while (in.available() > 0) {
            int n = in.read(buf);
            if (n < 0) {
                break;
            }
        }
    }

}
