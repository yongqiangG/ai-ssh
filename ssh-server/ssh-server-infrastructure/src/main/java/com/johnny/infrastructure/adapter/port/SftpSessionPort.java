package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpException;
import com.johnny.domain.ssh.adapter.port.ISftpPort;
import com.johnny.domain.ssh.adapter.port.SftpEntry;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * SFTP 端口实现；基于 JSch {@link ChannelSftp}，复用 {@link SshSessionPort} 持有的 SSH 会话。
 * <p>每个操作开一次性 sftp channel（{@code session.openChannel("sftp")}），用完 disconnect，
 * 与 {@code SshSessionPort} 的 exec 通道模型对称。
 */
@Slf4j
@Component
public class SftpSessionPort implements ISftpPort {

    /** channel 连接超时（毫秒），与 {@code SshSessionPort.CONNECT_TIMEOUT} 对齐 */
    private static final int CONNECT_TIMEOUT = 5000;

    /** 同层注入：复用其 {@code getSession(connectionId)} 拿底层 JSch Session（该方法不在领域端口接口，仅 infra 内部用） */
    @Resource
    private SshSessionPort sshSessionPort;

    @Override
    public List<SftpEntry> list(String connectionId, String path) {
        ChannelSftp channel = openChannel(connectionId);
        try {
            String target = resolvePath(channel, path);
            List<ChannelSftp.LsEntry> raw = channel.ls(target);
            List<SftpEntry> result = new ArrayList<>(raw.size());
            for (ChannelSftp.LsEntry e : raw) {
                String name = e.getFilename();
                if (".".equals(name) || "..".equals(name)) {
                    continue;
                }
                SftpEntry se = new SftpEntry();
                se.name = name;
                se.directory = e.getAttrs().isDir();
                se.size = e.getAttrs().getSize();
                // JSch mTime 为秒级，转毫秒
                se.lastModified = e.getAttrs().getMTime() * 1000L;
                result.add(se);
            }
            // 目录优先，再按名字升序（大小写不敏感）
            result.sort(Comparator
                    .comparing((SftpEntry e) -> !e.directory)
                    .thenComparing(e -> e.name.toLowerCase()));
            return result;
        } catch (Exception e) {
            throw wrap("列目录失败", connectionId, path, e);
        } finally {
            disconnectQuietly(channel);
        }
    }

    @Override
    public void upload(String connectionId, String remotePath, InputStream in, boolean overwrite) {
        ChannelSftp channel = openChannel(connectionId);
        try {
            String target = resolvePath(channel, remotePath);
            if (!overwrite && exists(channel, target)) {
                throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                        "远程已存在同名文件，未启用覆盖: " + target);
            }
            channel.put(in, target, ChannelSftp.OVERWRITE);
            log.info("SFTP 上传完成 connectionId={} remotePath={}", connectionId, target);
        } catch (AppException ae) {
            throw ae;
        } catch (Exception e) {
            throw wrap("上传失败", connectionId, remotePath, e);
        } finally {
            disconnectQuietly(channel);
        }
    }

    @Override
    public void download(String connectionId, String remotePath, OutputStream out) {
        ChannelSftp channel = openChannel(connectionId);
        try {
            // 必须解析 ~：JSch 不做 shell 扩展，直接 get("~/x") 会 No such file（list 已解析，upload/download 需对齐）
            String target = resolvePath(channel, remotePath);
            channel.get(target, out);
            out.flush();
            log.info("SFTP 下载完成 connectionId={} remotePath={}", connectionId, target);
        } catch (Exception e) {
            throw wrap("下载失败", connectionId, remotePath, e);
        } finally {
            disconnectQuietly(channel);
        }
    }

    // === 内部工具 ===

    /** 打开一次性 sftp channel；连接未建立时抛 AppException（对称 SshSessionPort.openShell 的校验） */
    private ChannelSftp openChannel(String connectionId) {
        Session session = sshSessionPort.getSession(connectionId);
        if (session == null || !session.isConnected()) {
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "SSH 未连接，无法操作文件 connectionId=" + connectionId);
        }
        try {
            ChannelSftp channel = (ChannelSftp) session.openChannel("sftp");
            channel.connect(CONNECT_TIMEOUT);
            return channel;
        } catch (Exception e) {
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "打开 SFTP 通道失败：" + e.getMessage(), e);
        }
    }

    /** 解析家目录简写：null/空/~ → home；~/x → home + /x */
    private String resolvePath(ChannelSftp channel, String path) throws SftpException {
        if (path == null || path.isBlank() || "~".equals(path.trim())) {
            return channel.getHome();
        }
        String p = path.trim();
        if (p.startsWith("~/")) {
            return channel.getHome() + p.substring(1);
        }
        return p;
    }

    /** 目标是否存在（文件或目录）；stat 抛 SftpException 视为不存在 */
    private boolean exists(ChannelSftp channel, String remotePath) {
        try {
            channel.stat(remotePath);
            return true;
        } catch (SftpException e) {
            return false;
        }
    }

    private void disconnectQuietly(ChannelSftp channel) {
        if (channel != null) {
            try {
                channel.disconnect();
            } catch (Exception ignored) {
                // 释放失败忽略，不影响主流程
            }
        }
    }

    private AppException wrap(String action, String connectionId, String path, Exception e) {
        log.error("SFTP {} 失败 connectionId={} path={} reason={}", action, connectionId, path, e.getMessage());
        return new AppException(ResponseCode.UN_ERROR.getCode(),
                action + "：" + e.getMessage(), e);
    }
}
