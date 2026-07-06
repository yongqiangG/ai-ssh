package com.johnny.trigger.http;

import com.johnny.api.response.Response;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 存活探针接口。
 * <p>
 * 供客户端「测试连接」探测后端可达性：不查 DB、不依赖任何 service，
 * 仅验证 HTTP 入口与应用上下文存活。返回标准 {@link Response}，
 * 客户端按 code==="0000" 判定后端健康。
 */
@RestController
@RequestMapping("/api")
public class PingController {

    @GetMapping("/ping")
    public Response<String> ping() {
        return Response.success("pong");
    }
}
