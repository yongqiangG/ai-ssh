package com.johnny.domain.ssh.adapter.port;

/**
 * 终端会话端口。
 * <p>
 * 定义交互式 shell 通道的基础能力，由基础设施层
 * {@code infrastructure.adapter.port.TerminalSessionPort} 基于 JSch ChannelShell 实现。
 * 以 sessionId 区分多个终端会话；一个 SSH 连接（connectionId）可先后打开多个会话，
 * 但同一时刻领域服务只保留最新一个。
 * <p>
 * 输出采用「后台线程持续读 → 缓冲区暂存 → {@link #drain} 取走」的轮询模型，
 * 前端定时调用 drain 拉取增量输出。
 */
public interface ITerminalSessionPort {

    /**
     * 在已建立的 SSH 连接上打开交互式 shell 通道，并启动后台输出读取线程。
     *
     * @param sessionId    终端会话唯一标识
     * @param connectionId 所属 SSH 连接标识（必须已连接）
     * @param cols         终端列数
     * @param rows         终端行数
     * @throws com.johnny.types.exception.AppException 连接未建立或通道打开失败
     */
    void open(String sessionId, String connectionId, int cols, int rows);

    /**
     * 向 shell 标准输入原样写入数据（不追加换行；按键、控制序列均按原字节透传）。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在或写入失败
     */
    void write(String sessionId, String data);

    /**
     * 取走并清空当前累积的 shell 输出；无新输出返回空字符串。
     * 会话不存在同样返回空字符串（由领域服务负责存在性校验）。
     */
    String drain(String sessionId);

    /**
     * 通道是否仍处于打开状态（连接中且未收到远端关闭）。
     */
    boolean isOpen(String sessionId);

    /**
     * 调整远端伪终端（pty）窗口尺寸。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在
     */
    void resize(String sessionId, int cols, int rows);

    /**
     * 关闭通道并释放缓冲/线程资源；会话不存在时不做任何操作（幂等）。
     */
    void close(String sessionId);
}
