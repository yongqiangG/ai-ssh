package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;

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
public class SshSessionPort implements ISshSessionPort {

    /** 连接超时时间（毫秒），避免不可达主机导致长时间阻塞 */
    private static final int CONNECT_TIMEOUT = 5000;

    /** 终端退出轮询间隔（毫秒） */
    private static final int SHELL_POLL_INTERVAL = 200;

    /** connectionId -> SSH 会话 */
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    @Override
    public boolean connect(String connectionId, String host, int port, String username, String password, String privateKey) {
        disconnect(connectionId);
        try {
            JSch jsch = new JSch();
            // 提供私钥时优先使用公钥认证
            boolean useKey = privateKey != null && !privateKey.isEmpty();
            if (useKey) {
                jsch.addIdentity(connectionId, privateKey.getBytes(StandardCharsets.UTF_8), null, null);
            }
            Session newSession = jsch.getSession(username, host, port);
            if (!useKey) {
                newSession.setPassword(password);
            }
            // 基础能力阶段跳过首次连接的主机密钥校验；后续应替换为已知主机（known_hosts）策略
            newSession.setConfig("StrictHostKeyChecking", "no");
            newSession.connect(CONNECT_TIMEOUT);
            sessions.put(connectionId, newSession);
            log.info("SSH 连接成功 connectionId={} host={} port={} username={} auth={}",
                    connectionId, host, port, username, useKey ? "key" : "password");
            return true;
        } catch (Exception e) {
            log.error("SSH 连接失败 connectionId={} host={} port={} username={}", connectionId, host, port, username, e);
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
                Thread.sleep(SHELL_POLL_INTERVAL);
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

}
