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
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Agent 装配注册中心 —— 启动时触发 armory 责任树装配，运行时按 agentId 查询容器中的 Runner。
 *
 * <p><b>瘦身为容器查询门面（Q6）：</b>删内部 Map 与顺序装配代码，{@link #build()} 触发 armory；
 * {@link #get} / {@link #listAgents} 走 {@link ApplicationContext}（bean 名约定 {@code aiAgentRunner_<agentId>}）。
 * 三个消费方（AiCallNode / ChatSessionService / ChatController）调用签名不变，一行不改。
 */
@Slf4j
@Component
public class AgentRunnerRegistry implements ApplicationRunner {

    @Resource
    private DefaultArmoryFactory defaultArmoryFactory;
    @Resource
    private ApplicationContext applicationContext;

    @Override
    public void run(ApplicationArguments args) {
        build();
    }

    /** 触发 armory 装配责任树（替代原 40 行顺序装配） */
    private void build() {
        try {
            defaultArmoryFactory.assembleAll();
        } catch (Exception e) {
            log.error("armory 装配失败", e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "Agent 装配失败：" + e.getMessage(), e);
        }
    }

    /**
     * 按 agentId 取 {@link AiAgentRegisterVO}；不存在抛 AppException。
     */
    public AiAgentRegisterVO get(String agentId) {
        try {
            return applicationContext.getBean("aiAgentRunner_" + agentId, AiAgentRegisterVO.class);
        } catch (NoSuchBeanDefinitionException e) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "智能体不存在: " + agentId);
        }
    }

    /**
     * 列出已装配智能体（供 /api/v1/agents 接口）。
     */
    public List<AgentDTO> listAgents() {
        return applicationContext.getBeansOfType(AiAgentRegisterVO.class).values().stream()
                .map(vo -> AgentDTO.builder()
                        .agentId(vo.getAgentId())
                        .agentName(vo.getAgentName())
                        .agentDesc(vo.getAgentDesc())
                        .build())
                .collect(Collectors.toList());
    }
}
