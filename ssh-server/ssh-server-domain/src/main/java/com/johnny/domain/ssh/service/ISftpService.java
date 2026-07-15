package com.johnny.domain.ssh.service;

import com.johnny.domain.ssh.adapter.port.SftpEntry;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * SFTP 领域服务接口。
 * <p>对 {@code ISftpPort} 做薄编排，供 trigger 层 {@code SftpController} 依赖；
 * 与 {@link ISshTerminalService} 同层对称。LLM 工具层（{@code SftpAdkTool}）直接依赖 port，
 * 不经此服务——与 {@code SshExecuteAdkTool} 直依赖 {@code ISshSessionPort} 的既有约定一致。
 */
public interface ISftpService {

    /** 列出远程目录条目；详见 {@code ISftpPort.list}。 */
    List<SftpEntry> list(String connectionId, String path);

    /** 上传文件流；详见 {@code ISftpPort.upload}。 */
    void upload(String connectionId, String remotePath, InputStream in, boolean overwrite);

    /** 下载远程文件；详见 {@code ISftpPort.download}。 */
    void download(String connectionId, String remotePath, OutputStream out);
}
