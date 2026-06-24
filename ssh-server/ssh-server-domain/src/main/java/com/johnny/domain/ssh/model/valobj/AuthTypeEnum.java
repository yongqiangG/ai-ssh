package com.johnny.domain.ssh.model.valobj;

import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * SSH 认证类型。
 */
@Getter
@AllArgsConstructor
public enum AuthTypeEnum {

    PASSWORD("PASSWORD", "密码认证"),
    PUBLIC_KEY("PUBLIC_KEY", "公钥认证");

    /** 认证类型编码，与 ssh_connection.auth_type 列对应 */
    private final String code;
    /** 描述 */
    private final String desc;

    /**
     * 根据编码解析枚举。
     *
     * @param code 认证类型编码（PASSWORD / PUBLIC_KEY）
     * @return 对应枚举值
     * @throws AppException 编码为空或非法时抛出
     */
    public static AuthTypeEnum of(String code) {
        if (code == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "认证类型不能为空");
        }
        for (AuthTypeEnum value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "非法认证类型: " + code);
    }
}
