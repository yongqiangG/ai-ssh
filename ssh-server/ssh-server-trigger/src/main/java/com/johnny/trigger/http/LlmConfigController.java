package com.johnny.trigger.http;

import com.johnny.api.dto.LlmConfigDTO;
import com.johnny.api.dto.LlmConfigRollbackSummaryDTO;
import com.johnny.api.dto.LlmConfigSaveRequestDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigRollbackSnapshot;
import com.johnny.domain.agent.model.LlmConfigSaveResult;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.agent.service.ILlmConfigRollbackService;
import com.johnny.domain.agent.service.ILlmConfigService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 本地 LLM 设置接口。当前只维护一个默认配置。
 */
@RestController
@RequestMapping("/api/v1/llm-config")
public class LlmConfigController {

    @Resource
    private ILlmConfigService llmConfigService;
    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;
    @Resource
    private ILlmConfigRollbackService llmConfigRollbackService;

    @GetMapping
    public Response<LlmConfigDTO> getConfig() {
        return Response.success(toDTO(llmConfigService.getDefaultConfig()));
    }

    @PostMapping
    public synchronized Response<LlmConfigDTO> saveConfig(@RequestBody LlmConfigSaveRequestDTO req) {
        LlmConfigEntity current = llmConfigService.getDefaultConfig();
        boolean keepExistingApiKey = req.getKeepExistingApiKey() == null || req.getKeepExistingApiKey();
        if (StringUtils.isBlank(req.getApiKey()) && !keepExistingApiKey) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "API Key 不能为空");
        }
        if (StringUtils.isBlank(req.getApiKey()) && !current.hasApiKey()) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "首次配置必须填写 API Key");
        }

        LlmConfigSaveResult result = llmConfigService.saveDefaultConfig(LlmConfigEntity.builder()
                .providerName(req.getProviderName())
                .baseUrl(req.getBaseUrl())
                .apiKey(req.getApiKey())
                .model(req.getModel())
                .completionsPath(req.getCompletionsPath())
                .build(), keepExistingApiKey);
        if (result.isConfigChanged() && current.hasApiKey()) {
            llmConfigRollbackService.remember(
                    current,
                    result.getConfig(),
                    result.isRunnerReloadRequired());
        }
        boolean runnerRebuilt = false;
        if (result.isRunnerReloadRequired()) {
            agentRunnerRegistry.rebuild();
            runnerRebuilt = true;
        }
        LlmConfigDTO dto = toDTO(result.getConfig());
        dto.setConfigChanged(result.isConfigChanged());
        dto.setRunnerReloadRequired(result.isRunnerReloadRequired());
        dto.setRunnerRebuilt(runnerRebuilt);
        return Response.success(dto);
    }

    @PostMapping("/rollback")
    public synchronized Response<LlmConfigDTO> rollbackConfig() {
        LlmConfigRollbackSnapshot snapshot = llmConfigRollbackService.getSnapshot()
                .orElseThrow(() -> new AppException(
                        ResponseCode.ILLEGAL_PARAMETER.getCode(), "当前没有可用的上一版模型配置"));
        LlmConfigEntity current = llmConfigService.getDefaultConfig();

        boolean retryRunnerRebuild = snapshot.matchesPrevious(current);
        if (!retryRunnerRebuild && !snapshot.matchesCurrent(current)) {
            throw new AppException(
                    ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "模型配置已发生变化，请重新打开设置后重试回滚");
        }

        LlmConfigEntity restored = current;
        boolean runnerReloadRequired = snapshot.isRunnerReloadRequired();
        boolean configChanged = false;
        if (!retryRunnerRebuild) {
            LlmConfigSaveResult result = llmConfigService.saveDefaultConfig(
                    snapshot.getPreviousConfig(), false);
            restored = result.getConfig();
            runnerReloadRequired = result.isRunnerReloadRequired();
            configChanged = result.isConfigChanged();
        }

        boolean runnerRebuilt = false;
        if (runnerReloadRequired) {
            agentRunnerRegistry.rebuild();
            runnerRebuilt = true;
        }
        llmConfigRollbackService.clear();

        LlmConfigDTO dto = toDTO(restored);
        dto.setConfigChanged(configChanged);
        dto.setRunnerReloadRequired(runnerReloadRequired);
        dto.setRunnerRebuilt(runnerRebuilt);
        return Response.success(dto);
    }

    private LlmConfigDTO toDTO(LlmConfigEntity entity) {
        LlmConfigDTO.LlmConfigDTOBuilder builder = LlmConfigDTO.builder()
                .providerName(entity.getProviderName())
                .baseUrl(entity.getBaseUrl())
                .model(entity.getModel())
                .completionsPath(entity.getCompletionsPath())
                .apiKeyConfigured(entity.hasApiKey())
                .configChanged(false)
                .runnerReloadRequired(false)
                .runnerRebuilt(false);
        llmConfigRollbackService.getSnapshot().ifPresentOrElse(
                snapshot -> builder
                        .rollbackAvailable(true)
                        .rollbackConfig(toRollbackSummary(snapshot.getPreviousConfig())),
                () -> builder.rollbackAvailable(false).rollbackConfig(null));
        return builder.build();
    }

    private LlmConfigRollbackSummaryDTO toRollbackSummary(LlmConfigEntity entity) {
        return LlmConfigRollbackSummaryDTO.builder()
                .providerName(entity.getProviderName())
                .baseUrl(entity.getBaseUrl())
                .model(entity.getModel())
                .completionsPath(entity.getCompletionsPath())
                .apiKeyConfigured(entity.hasApiKey())
                .build();
    }
}
