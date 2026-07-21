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
     * <p>高级配置（connectTimeout/keepaliveInterval/compression 等）由 {@link ConnectParams} 携带并真正生效。
     *
     * @param connectionId 连接唯一标识，用于区分多个 SSH 连接
     * @param params       连接参数（凭据 + 高级配置）
     * @return 连接成功返回 true，失败返回 false
     */
    boolean connect(String connectionId, ConnectParams params);

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

    /**
     * 在已建立的连接上执行单条命令，阻塞直到命令结束并返回标准输出。
     *
     * @param connectionId 连接唯一标识
     * @param command      要执行的单条命令
     * @return 命令的标准输出
     * @throws com.johnny.types.exception.AppException 连接未建立或执行失败时抛出
     */
    String exec(String connectionId, String command);

    /**
     * 在 connectionId 对应连接上开一次性 ChannelExec 执行命令，返回结构化结果（供 AI 工具使用，Q1）。
     * <p>stdout/stderr 分开采集 + 真实退出码 + 超时强断，与终端 shell 通道隔离，不污染前端轮询缓冲。
     * <p><b>不抛异常</b>——连接级失败返回 {@code null}（由工具层判空转错误 Map，Q3a）。
     *
     * @param connectionId SSH 连接 id
     * @param command      单条 shell 命令
     * @param timeoutMs    超时毫秒；超时强断通道，{@code timedOut=true}，连同已捕获输出返回
     * @return 结构化结果；连接不存在/已断返回 {@code null}
     */
    ExecResult exec(String connectionId, String command, long timeoutMs);

}
