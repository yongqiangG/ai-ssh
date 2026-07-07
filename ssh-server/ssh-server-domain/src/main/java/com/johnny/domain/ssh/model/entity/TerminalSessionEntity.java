package com.johnny.domain.ssh.model.entity;

import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.Getter;
import org.apache.commons.lang3.StringUtils;

/**
 * 终端会话实体（富领域模型）。
 * <p>
 * 表示一个已打开的交互式 shell 会话，由 {@code SshTerminalService} 以 sessionId 索引缓存。
 * 记录最后活跃时间（{@link #touch()}）与关闭标记（{@link #markClosed()}），
 * 供后续读写前的会话有效性校验及将来空闲回收使用。
 * <p>
 * 仅暴露 getter；创建走工厂方法 {@link #create}。closed 为 volatile：
 * 读轮询（发现通道已关时标记）与其它 HTTP 请求线程可能并发访问。
 */
@Getter
public class TerminalSessionEntity {

    private String sessionId;
    private String connectionId;
    private String userId;
    /** 创建时间（epoch millis） */
    private long createdAt;
    /** 最后活跃时间（epoch millis），任一读写操作都会刷新 */
    private volatile long lastActiveAt;
    /** 会话是否已关闭（通道断开或主动关闭后置位，不可逆） */
    private volatile boolean closed;

    private TerminalSessionEntity() {
    }

    /**
     * 新建终端会话实体；校验标识字段非空。
     *
     * @throws AppException 任一标识为空
     */
    public static TerminalSessionEntity create(String sessionId, String connectionId, String userId) {
        if (StringUtils.isBlank(sessionId)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "sessionId 不能为空");
        }
        if (StringUtils.isBlank(connectionId)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "connectionId 不能为空");
        }
        if (StringUtils.isBlank(userId)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "userId 不能为空");
        }
        TerminalSessionEntity entity = new TerminalSessionEntity();
        entity.sessionId = sessionId;
        entity.connectionId = connectionId;
        entity.userId = userId;
        long now = System.currentTimeMillis();
        entity.createdAt = now;
        entity.lastActiveAt = now;
        entity.closed = false;
        return entity;
    }

    /** 刷新最后活跃时间；每次读写/调整尺寸前调用 */
    public void touch() {
        this.lastActiveAt = System.currentTimeMillis();
    }

    /** 标记会话已关闭（通道断开或主动关闭），不可逆 */
    public void markClosed() {
        this.closed = true;
    }
}
