package com.johnny.domain.ssh.service;

/**
 * SSH 终端领域服务接口。
 * <p>
 * 编排交互式终端会话的生命周期：打开（校验连接、清理旧会话、缓存会话实体）、
 * 读写、调整尺寸与关闭。通道操作委托 {@code ITerminalSessionPort}。
 * <p>
 * 读写模型为轮询式：写入即时下发；输出由基础设施层后台线程缓冲，
 * 前端通过 {@link #read} 定时拉取增量。
 */
public interface ISshTerminalService {

    /**
     * 打开终端会话。
     * <p>
     * 流程：校验 SSH 连接已建立 → 清理该连接的旧终端会话 → 经端口打开 shell 通道
     * → 创建并缓存会话实体 → 阻塞等待初始输出（motd/欢迎信息与首个提示符）积累完毕，
     * 一次性随结果返回，避免前端分片渲染闪烁。
     *
     * @return sessionId 与初始输出
     * @throws com.johnny.types.exception.AppException 连接未建立或通道打开失败
     */
    OpenResult open(OpenCmd cmd);

    /**
     * 执行整行命令（自动补换行触发执行），用于 AI 在用户终端里执行命令；
     * 命令输出与普通交互一样经 {@link #read} 流回前端。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在或已失效
     */
    void execCommand(String sessionId, String command);

    /**
     * 逐字节原样写入，用于用户与终端的实时交互（按键、控制序列透传，不做任何加工）。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在或已失效
     */
    void write(String sessionId, String data);

    /**
     * 读取自上次调用以来累积的终端输出（取走即清空）。
     * <p>
     * 返回的 {@code closed} 为后端断联标记：通道已被远端或本端关闭时置 true，
     * 前端据此停止轮询并提示断开。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在
     */
    ReadResult read(String sessionId);

    /**
     * 调整远端伪终端窗口尺寸（前端容器尺寸变化时调用）。
     *
     * @throws com.johnny.types.exception.AppException 会话不存在或已失效
     */
    void resize(String sessionId, int cols, int rows);

    /**
     * 关闭终端会话并释放资源；会话不存在时不报错（幂等）。
     */
    void close(String sessionId);

    /**
     * 由终端 sessionId 反查 SSH 连接 id（供 AI 工具层定位 exec 通道，Q3b）。
     *
     * @param sessionId 终端会话 id
     * @return 对应 connectionId；会话不存在返回 null（工具层判空转错误 Map）
     */
    String getConnectionId(String sessionId);

    /** 打开终端命令（纯 POJO，字段即入参） */
    class OpenCmd {
        public String connectionId;
        public String userId;
        /** 终端列数；非正数时由实现方取默认值 */
        public int cols;
        /** 终端行数；非正数时由实现方取默认值 */
        public int rows;
    }

    /** 打开终端结果 */
    class OpenResult {
        public String sessionId;
        /** 初始输出（motd + 首个提示符），可能为空字符串 */
        public String initialOutput;
    }

    /** 读取终端输出结果 */
    class ReadResult {
        /** 增量输出；无新输出为空字符串 */
        public String content;
        /** 后端断联标记：通道已关闭时为 true，前端应停止轮询 */
        public boolean closed;
    }
}
