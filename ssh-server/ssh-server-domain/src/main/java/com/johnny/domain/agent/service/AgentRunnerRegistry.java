package com.johnny.domain.agent.service;

import com.johnny.api.dto.AgentDTO;
import com.johnny.domain.agent.armory.DefaultArmoryFactory;
import com.johnny.domain.agent.model.AiAgentRegisterVO;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Agent 装配注册中心。启动时装配 runner，运行时按 agentId 从 Spring 容器查询。
 *
 * <p>就绪语义：内嵌 Tomcat 在 context refresh 期间即开始监听，而本类的 {@link ApplicationRunner}
 * 在其后才执行——存在"/api/ping 已通但 agent 未装配"的窗口。{@link #listAgents()} 用
 * {@code firstAssemblyDone} latch 等待首次装配结束（成功或缺 key 跳过均算结束），
 * 消除前端启动期拉到空列表的竞态。
 */
@Slf4j
@Component
public class AgentRunnerRegistry implements ApplicationRunner {

    /** 首次装配尝试结束（成功 / 失败 / 缺 key 跳过都算）后 countDown */
    private final CountDownLatch firstAssemblyDone = new CountDownLatch(1);

    @Resource
    private DefaultArmoryFactory defaultArmoryFactory;
    @Resource
    private ApplicationContext applicationContext;
    @Resource
    private Environment environment;

    @Override
    public void run(ApplicationArguments args) {
        try {
            rebuild();
        } finally {
            firstAssemblyDone.countDown();
        }
    }

    public synchronized void rebuild() {
        try {
            defaultArmoryFactory.assembleAll();
        } catch (Exception e) {
            if (environment.acceptsProfiles(Profiles.of("single")) && isMissingApiKey(e)) {
                log.warn("single 模式未配置 LLM API Key，跳过 Agent 装配；保存模型设置后会重新装配");
                return;
            }
            log.error("armory 装配失败", e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "Agent 装配失败：" + e.getMessage(), e);
        }
    }

    public AiAgentRegisterVO get(String agentId) {
        try {
            return applicationContext.getBean("aiAgentRunner_" + agentId, AiAgentRegisterVO.class);
        } catch (NoSuchBeanDefinitionException e) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "智能体不存在: " + agentId);
        }
    }

    public List<AgentDTO> listAgents() {
        awaitFirstAssembly();
        return applicationContext.getBeansOfType(AiAgentRegisterVO.class).values().stream()
                .map(vo -> AgentDTO.builder()
                        .agentId(vo.getAgentId())
                        .agentName(vo.getAgentName())
                        .agentDesc(vo.getAgentDesc())
                        .build())
                .collect(Collectors.toList());
    }

    /** 等首次装配结束（10s 超时兜底：装配卡死时放行返回当前快照，不无限阻塞请求） */
    private void awaitFirstAssembly() {
        try {
            if (!firstAssemblyDone.await(10, TimeUnit.SECONDS)) {
                log.warn("等待首次 Agent 装配超时（10s），按当前注册快照返回");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private boolean isMissingApiKey(Exception e) {
        Throwable current = e;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.contains("api-key")) {
                return true;
            }
            if (current instanceof AppException appException) {
                String info = appException.getInfo();
                if (info != null && info.contains("api-key")) {
                    return true;
                }
            }
            current = current.getCause();
        }
        return false;
    }
}
