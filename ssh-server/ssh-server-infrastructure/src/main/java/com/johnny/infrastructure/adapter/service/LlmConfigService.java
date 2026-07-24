package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigSaveResult;
import com.johnny.domain.agent.service.ILlmConfigService;
import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import com.johnny.infrastructure.dao.ILlmConfigDao;
import com.johnny.infrastructure.dao.po.LlmConfigPO;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class LlmConfigService implements ILlmConfigService {

    private final ILlmConfigDao llmConfigDao;
    private final ISecretCipher cipher;

    @Value("${llm.default.provider-name:OpenAI Compatible}")
    private String defaultProviderName;

    @Value("${llm.default.base-url:https://open.bigmodel.cn}")
    private String defaultBaseUrl;

    @Value("${llm.default.completions-path:/api/coding/paas/v4/chat/completions}")
    private String defaultCompletionsPath;

    @Value("${llm.default.model:glm-5.2}")
    private String defaultModel;

    public LlmConfigService(ILlmConfigDao llmConfigDao, ISecretCipher cipher) {
        this.llmConfigDao = llmConfigDao;
        this.cipher = cipher;
    }

    @Override
    public LlmConfigEntity getDefaultConfig() {
        LlmConfigPO po = llmConfigDao.queryByConfigId(LlmConfigEntity.DEFAULT_CONFIG_ID);
        if (po == null) {
            return defaultConfig("");
        }
        return toEntity(po);
    }

    @Override
    public LlmConfigSaveResult saveDefaultConfig(LlmConfigEntity config, boolean keepExistingApiKey) {
        LlmConfigEntity current = getDefaultConfig();
        String apiKey = keepExistingApiKey && StringUtils.isBlank(config.getApiKey())
                ? current.getApiKey()
                : config.getApiKey();
        LlmConfigEntity normalized = LlmConfigEntity.builder()
                .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                .providerName(StringUtils.defaultIfBlank(config.getProviderName(), defaultProviderName))
                .baseUrl(StringUtils.defaultIfBlank(config.getBaseUrl(), defaultBaseUrl))
                .apiKey(apiKey)
                .model(StringUtils.defaultIfBlank(config.getModel(), defaultModel))
                .completionsPath(StringUtils.defaultIfBlank(config.getCompletionsPath(), defaultCompletionsPath))
                .build();

        boolean configChanged = !sameConfig(current, normalized);
        boolean runnerReloadRequired = configChanged
                && (changed(current.getBaseUrl(), normalized.getBaseUrl())
                || changed(current.getModel(), normalized.getModel())
                || changed(current.getCompletionsPath(), normalized.getCompletionsPath())
                || changed(current.getApiKey(), normalized.getApiKey()));

        if (configChanged) {
            LlmConfigPO po = toPO(normalized);
            if (llmConfigDao.queryByConfigId(LlmConfigEntity.DEFAULT_CONFIG_ID) == null) {
                llmConfigDao.insert(po);
            } else {
                llmConfigDao.update(po);
            }
        }
        return LlmConfigSaveResult.builder()
                .config(normalized)
                .configChanged(configChanged)
                .runnerReloadRequired(runnerReloadRequired)
                .build();
    }

    private boolean sameConfig(LlmConfigEntity left, LlmConfigEntity right) {
        return !changed(left.getProviderName(), right.getProviderName())
                && !changed(left.getBaseUrl(), right.getBaseUrl())
                && !changed(left.getApiKey(), right.getApiKey())
                && !changed(left.getModel(), right.getModel())
                && !changed(left.getCompletionsPath(), right.getCompletionsPath());
    }

    private boolean changed(String left, String right) {
        return !StringUtils.equals(left, right);
    }

    private LlmConfigEntity defaultConfig(String apiKey) {
        return LlmConfigEntity.builder()
                .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                .providerName(defaultProviderName)
                .baseUrl(defaultBaseUrl)
                .apiKey(apiKey)
                .model(defaultModel)
                .completionsPath(defaultCompletionsPath)
                .build();
    }

    private LlmConfigEntity toEntity(LlmConfigPO po) {
        return LlmConfigEntity.builder()
                .configId(po.getConfigId())
                .providerName(po.getProviderName())
                .baseUrl(po.getBaseUrl())
                .apiKey(cipher.decrypt(po.getApiKey()))
                .model(po.getModel())
                .completionsPath(po.getCompletionsPath())
                .build();
    }

    private LlmConfigPO toPO(LlmConfigEntity entity) {
        return LlmConfigPO.builder()
                .configId(entity.getConfigId())
                .providerName(entity.getProviderName())
                .baseUrl(entity.getBaseUrl())
                .apiKey(cipher.encrypt(entity.getApiKey()))
                .model(entity.getModel())
                .completionsPath(entity.getCompletionsPath())
                .build();
    }
}
