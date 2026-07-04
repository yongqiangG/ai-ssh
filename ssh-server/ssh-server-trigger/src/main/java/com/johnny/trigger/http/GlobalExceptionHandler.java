package com.johnny.trigger.http;

import com.johnny.api.response.Response;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理。
 * <p>
 * 统一把异常转为结构化 {@link Response}（HTTP 200），前端按 {@code code!=="0000"} 判错，
 * 保证任何异常下都能拿到可解析的 JSON。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 业务异常：透传异常码与描述信息 */
    @ExceptionHandler(AppException.class)
    public Response<Void> handleAppException(AppException e) {
        log.warn("业务异常: code={}, info={}", e.getCode(), e.getInfo());
        return Response.fail(
                e.getCode() == null ? ResponseCode.UN_ERROR.getCode() : e.getCode(),
                e.getInfo());
    }

    /** 兜底：未知异常统一归为 UN_ERROR，避免堆栈泄漏到前端 */
    @ExceptionHandler(Exception.class)
    public Response<Void> handleException(Exception e) {
        log.error("系统异常", e);
        return Response.fail(ResponseCode.UN_ERROR.getCode(), "系统异常: " + e.getMessage());
    }
}
