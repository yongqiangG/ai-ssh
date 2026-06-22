package com.johnny.domain.ssh.adapter.port;

import java.io.InputStream;
import java.io.OutputStream;

/**
 * SSH 会话端口
 * <p>
 * 定义 SSH 客户端的基础能力，由基础设施层 {@code infrastructure.adapter.port.SshSessionPort} 具体实现。
 * 以 connectionId 区分多个 SSH 连接，支持密码与私钥两种认证方式。
 */
public interface ISshSessionPort {

    /**
     * 建立 SSH 连接；支持密码与私钥两种认证（提供 privateKey 时优先使用私钥认证）。
     *
     * @param connectionId 连接唯一标识，用于区分多个 SSH 连接
     * @param host         目标主机地址
     * @param port         SSH 端口
     * @param username     登录用户名
     * @param password     登录密码（使用私钥认证时可传 null）
     * @param privateKey   SSH 私钥内容（PEM 格式；使用密码认证时可传 null）
     * @return 连接成功返回 true，失败返回 false
     */
    boolean connect(String connectionId, String host, int port, String username, String password, String privateKey);

    /**
     * 断开指定连接；若不存在或未连接则不做任何操作。
     *
     * @param connectionId 连接唯一标识
     */
    void disconnect(String connectionId);

    /**
     * 检查指定连接是否已建立。
     *
     * @param connectionId 连接唯一标识
     * @return 已连接返回 true，否则返回 false
     */
    boolean isConnected(String connectionId);

    /**
     * 打开指定连接的交互式 shell 终端，将给定输入/输出流桥接到远端，阻塞直到 shell 退出。
     *
     * @param connectionId 连接唯一标识
     * @param in           终端输入流（接收用户键入的命令）
     * @param out          终端输出流（回显服务器返回内容）
     */
    void openShell(String connectionId, InputStream in, OutputStream out);

}
