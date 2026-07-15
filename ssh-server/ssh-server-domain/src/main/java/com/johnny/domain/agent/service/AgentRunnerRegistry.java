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
import java.util.stream.Collectors;

/**
 * Agent 装配注册中心。启动时装配 runner，运行时按 agentId 从 Spring 容器查询。
 */
@Slf4j
@Component
public class AgentRunnerRegistry implements ApplicationRunner {

    @Resource
    private DefaultArmoryFactory defaultArmoryFactory;
    @Resource
    private ApplicationContext applicationContext;
    @Resource
    private Environment environment;

    @Override
    public void run(ApplicationArguments args) {
        rebuild();
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
        return applicationContext.getBeansOfType(AiAgentRegisterVO.class).values().stream()
                .map(vo -> AgentDTO.builder()
                        .agentId(vo.getAgentId())
                        .agentName(vo.getAgentName())
                        .agentDesc(vo.getAgentDesc())
                        .build())
                .collect(Collectors.toList());
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
