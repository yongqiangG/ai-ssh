package com.johnny.domain.ssh.model.valobj;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * SSH 连接状态。
 */
@Getter
@AllArgsConstructor
public enum ConnectionStatusVO {

    DISCONNECTED(0, "未连接"),
    CONNECTED(1, "已连接");

    /** 状态编码，与 ssh_connection.status 列对应 */
    private final int code;
    /** 描述 */
    private final String desc;

    /**
     * 根据编码解析枚举；null 或无法识别时回退为 {@link #DISCONNECTED}（读取历史/脏数据时容错）。
     *
     * @param code 状态编码
     * @return 对应枚举值
     */
    public static ConnectionStatusVO of(Integer code) {
        if (code == null) {
            return DISCONNECTED;
        }
        for (ConnectionStatusVO value : values()) {
            if (value.code == code) {
                return value;
            }
        }
        return DISCONNECTED;
    }
}
