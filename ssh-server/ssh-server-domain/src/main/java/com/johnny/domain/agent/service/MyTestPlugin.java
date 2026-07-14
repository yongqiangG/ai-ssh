package com.johnny.domain.agent.service;

import com.google.adk.agents.BaseAgent;
import com.google.adk.agents.CallbackContext;
import com.google.adk.agents.InvocationContext;
import com.google.adk.models.LlmRequest;
import com.google.adk.models.LlmResponse;
import com.google.adk.plugins.BasePlugin;
import com.google.adk.tools.BaseTool;
import com.google.adk.tools.ToolContext;
import com.google.genai.types.Content;
import io.reactivex.rxjava3.core.Maybe;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.stream.Collectors;

/**
 * 联调观测插件：9 回调全部旁观打中文日志，对照设计文档 §1 日志验收样例。
 *
 * <p>bean 名 {@code myTestPlugin}（ssh-agent.yml runner.plugin-name-list 引用它）。
 *
 * <p><b>⚠️ 返回值语义陷阱：</b>回调返回<b>非空</b> Maybe 会短路框架行为——
 * 例如 beforeToolCallback 返回非空 Map 会跳过工具执行、拿返回值当结果。
 * 故全部用 {@code Maybe.fromAction(()->...)} 返回 empty（fromAction 执行副作用后产 empty）。
 *
 * <p>字段取法借鉴反编译的 {@code com.google.adk.plugins.LoggingPlugin}（docs/decompiled/），
 * 但输出中文格式化、对照 §1 样例。
 */
@Slf4j
@Component("myTestPlugin")
public class MyTestPlugin extends BasePlugin {

    public MyTestPlugin() {
        super("myTestPlugin");
    }

    /** 🚀 用户输入信息 */
    @Override
    public Maybe<Content> onUserMessageCallback(InvocationContext ctx, Content userMessage) {
        return Maybe.fromAction(() -> {
            String content = userMessage == null ? "" : userMessage.parts()
                    .map(parts -> parts.stream().map(p -> p.text().orElse("")).collect(Collectors.joining()))
                    .orElse("");
            log.info("插件日志-🚀 用户输入信息 | invocationId:{} | userId:{} | content:{}",
                    ctx.invocationId(), ctx.userId(), content);
        });
    }

    /** 🤖 智能体启动 */
    @Override
    public Maybe<Content> beforeAgentCallback(BaseAgent agent, CallbackContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🤖 智能体启动 | agentName:{} | invocationId:{}",
                        ctx.agentName(), ctx.invocationId()));
    }

    /** 🧠 大模型请求（含可用工具） */
    @Override
    public Maybe<LlmResponse> beforeModelCallback(CallbackContext ctx, LlmRequest.Builder reqBuilder) {
        return Maybe.fromAction(() -> {
            LlmRequest req = reqBuilder.build();
            String model = req.model().orElse("default");
            String tools = req.tools().keySet().stream().sorted().collect(Collectors.joining(","));
            log.info("插件日志-🧠 大模型请求 | agent:{} | model:{} | 可用工具:[{}]",
                    ctx.agentName(), model, tools);
        });
    }

    /** 🧠 大模型响应（turnComplete） */
    @Override
    public Maybe<LlmResponse> afterModelCallback(CallbackContext ctx, LlmResponse resp) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🧠 大模型响应 | agent:{} | turnComplete:{}",
                        ctx.agentName(), resp.turnComplete().orElse(false)));
    }

    /** 🔧 工具调用开始 */
    @Override
    public Maybe<Map<String, Object>> beforeToolCallback(BaseTool tool, Map<String, Object> args, ToolContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🔧 工具调用开始 | tool:{} | args:{}",
                        tool.name(), args));
    }

    /** 🔧 工具调用完成 */
    @Override
    public Maybe<Map<String, Object>> afterToolCallback(BaseTool tool, Map<String, Object> args,
                                                        ToolContext ctx, Map<String, Object> result) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🔧 工具调用完成 | tool:{} | result:{}",
                        tool.name(), result));
    }

    /** 🤖 智能体完成 */
    @Override
    public Maybe<Content> afterAgentCallback(BaseAgent agent, CallbackContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🤖 智能体完成 | agentName:{}", ctx.agentName()));
    }

    /** ❌ 大模型调用异常 */
    @Override
    public Maybe<LlmResponse> onModelErrorCallback(CallbackContext ctx, LlmRequest.Builder reqBuilder, Throwable error) {
        // slf4j：最后一个可变参数若为 Throwable 会自动作为堆栈输出
        return Maybe.fromAction(() ->
                log.error("插件日志-❌ 大模型调用异常 | agent:{} | error:{}",
                        ctx.agentName(), error.getMessage(), error));
    }

    /** ❌ 工具调用异常 */
    @Override
    public Maybe<Map<String, Object>> onToolErrorCallback(BaseTool tool, Map<String, Object> args,
                                                          ToolContext ctx, Throwable error) {
        return Maybe.fromAction(() ->
                log.error("插件日志-❌ 工具调用异常 | tool:{} | args:{} | error:{}",
                        tool.name(), args, error.getMessage(), error));
    }
}
