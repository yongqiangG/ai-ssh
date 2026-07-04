package com.johnny.api.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Response<T> implements Serializable {

    private static final long serialVersionUID = 7000723935764546321L;

    /** 成功码，与 ResponseCode.SUCCESS 对齐（api 模块不依赖 types，故内联字面量） */
    private static final String SUCCESS_CODE = "0000";
    private static final String SUCCESS_INFO = "成功";

    private String code;
    private String info;
    private T data;

    /** 成功响应快捷构造 */
    public static <T> Response<T> success(T data) {
        return Response.<T>builder()
                .code(SUCCESS_CODE)
                .info(SUCCESS_INFO)
                .data(data)
                .build();
    }

    /** 失败响应快捷构造 */
    public static <T> Response<T> fail(String code, String info) {
        return Response.<T>builder().code(code).info(info).data(null).build();
    }

}
