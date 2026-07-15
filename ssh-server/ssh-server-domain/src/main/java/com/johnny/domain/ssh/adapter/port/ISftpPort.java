package com.johnny.domain.ssh.adapter.port;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * SFTP 端口。
 * <p>定义远程文件的能力：列目录、上传、下载。由基础设施层
 * {@code infrastructure.adapter.port.SftpSessionPort} 基于 JSch {@code ChannelSftp} 实现。
 * 复用已建立的 SSH 会话（按 {@code connectionId} 索引，由 {@code SshSessionPort} 持有），
 * 与 shell 通道并存——同一 session 不同 channel，互不干扰。
 *
 * <p>实现约定：每个操作开一次性 sftp channel，用完 {@code disconnect()}，对称 exec 通道模型。
 * path 支持 {@code ~} / {@code ~/xxx} 家目录简写（由实现解析）。
 */
public interface ISftpPort {

    /**
     * 列出远程目录条目（目录优先、名字升序，自动剔除 {@code .} / {@code ..}）。
     *
     * @param connectionId SSH 连接 id（必须已建立）
     * @param path         远程目录绝对路径，{@code null}/空/{@code ~} 表示家目录
     * @return 条目列表；连接未建立或路径不存在时抛 {@code AppException}
     */
    List<SftpEntry> list(String connectionId, String path);

    /**
     * 上传文件流到远程路径。
     *
     * @param connectionId SSH 连接 id
     * @param remotePath   远程目标绝对路径
     * @param in           本地文件输入流（调用方负责关闭）
     * @param overwrite    {@code false} 且目标已存在时抛 {@code AppException}；{@code true} 覆盖
     */
    void upload(String connectionId, String remotePath, InputStream in, boolean overwrite);

    /**
     * 下载远程文件到输出流。
     *
     * @param connectionId SSH 连接 id
     * @param remotePath   远程文件绝对路径
     * @param out          接收方输出流（调用方负责关闭）
     */
    void download(String connectionId, String remotePath, OutputStream out);
}
