import { useEffect, useState } from "react";
import {
  getLlmConfig,
  rollbackLlmConfig,
  saveLlmConfig,
  type LlmConfigRollbackSummary,
} from "../api/llmConfig";
import { useChatStore } from "../stores/chatStore";
import { classifyLlmConfigChange } from "../utils/llmConfigChange";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "./Icon";
import modalStyles from "./sshConnectionModal.module.css";

interface LlmSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface LoadedLlmConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  completionsPath: string;
  apiKeyConfigured: boolean;
}

export default function LlmSettingsModal({ open, onClose }: LlmSettingsModalProps) {
  const [providerName, setProviderName] = useState("OpenAI Compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [completionsPath, setCompletionsPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [rollbackConfig, setRollbackConfig] = useState<LlmConfigRollbackSummary | null>(null);
  const [loadedConfig, setLoadedConfig] = useState<LoadedLlmConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const sending = useChatStore((s) => s.sending);
  const conversations = useChatStore((s) => s.conversations);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setApiKey("");
    getLlmConfig()
      .then((config) => {
        setLoadedConfig({
          providerName: config.providerName || "OpenAI Compatible",
          baseUrl: config.baseUrl || "",
          model: config.model || "",
          completionsPath: config.completionsPath || "",
          apiKeyConfigured: Boolean(config.apiKeyConfigured),
        });
        setProviderName(config.providerName || "OpenAI Compatible");
        setBaseUrl(config.baseUrl || "");
        setModel(config.model || "");
        setCompletionsPath(config.completionsPath || "");
        setApiKeyConfigured(Boolean(config.apiKeyConfigured));
        setRollbackAvailable(Boolean(config.rollbackAvailable));
        setRollbackConfig(config.rollbackConfig ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  /** 第二段：真正保存（直接触发，或经归档确认后触发） */
  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveLlmConfig({
        providerName,
        baseUrl,
        apiKey,
        model,
        completionsPath,
        keepExistingApiKey: apiKeyConfigured && !apiKey.trim(),
      });
      if (result.configChanged) {
        await useChatStore.getState().loadAgents();
      }
      if (result.runnerRebuilt) {
        useChatStore
          .getState()
          .archiveAllAndStartNew("model_reloaded", "模型配置已更新，原对话已转为历史");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const doRollback = async () => {
    setRollingBack(true);
    setError(null);
    try {
      const result = await rollbackLlmConfig();
      if (result.configChanged || result.runnerRebuilt) {
        await useChatStore.getState().loadAgents();
        useChatStore
          .getState()
          .archiveAllAndStartNew("model_reloaded", "模型配置已回滚，原对话已转为历史");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRollingBack(false);
    }
  };

  /** 第一段：忙时拦截 + 变更判定；需要结束会话时先弹应用内确认 */
  const requestSave = () => {
    setError(null);
    const store = useChatStore.getState();
    // 只看活动对话：历史对话经归档口清理不会携带进行中块，也不该阻塞保存
    const hasActiveToolCalls = store.conversations.some(
      (c) =>
        c.contextStatus !== "history" &&
        c.messages.some((m) =>
          m.toolCalls?.some(
            (tc) => tc.status === "running" || tc.status === "pending_confirm"
          )
        )
    );
    if (store.sending || hasActiveToolCalls) {
      setError("当前 AI 会话正在进行中，请先停止或等待结束后再保存模型配置");
      return;
    }

    const currentConfig =
      loadedConfig ?? {
        providerName: "OpenAI Compatible",
        baseUrl: "",
        model: "",
        completionsPath: "",
        apiKeyConfigured: false,
      };
    const changeKind = classifyLlmConfigChange(currentConfig, {
      providerName,
      baseUrl,
      apiKey,
      model,
      completionsPath,
      keepExistingApiKey: apiKeyConfigured && !apiKey.trim(),
    });
    const hasActiveConversation = store.conversations.some(
      (c) => c.contextStatus !== "history" && c.messages.length > 0
    );
    if (changeKind === "runner_reload" && hasActiveConversation) {
      setArchiveConfirmOpen(true);
      return;
    }
    void doSave();
  };

  const requestRollback = () => {
    setError(null);
    const store = useChatStore.getState();
    const hasActiveToolCalls = store.conversations.some(
      (c) =>
        c.contextStatus !== "history" &&
        c.messages.some((m) =>
          m.toolCalls?.some(
            (tc) => tc.status === "running" || tc.status === "pending_confirm"
          )
        )
    );
    if (store.sending || hasActiveToolCalls) {
      setError("当前 AI 会话正在进行中，请先停止或等待结束后再回滚模型配置");
      return;
    }
    setRollbackConfirmOpen(true);
  };

  const hasActiveToolCalls = conversations.some(
    (c) =>
      c.contextStatus !== "history" &&
      c.messages.some((m) =>
        m.toolCalls?.some(
          (tc) => tc.status === "running" || tc.status === "pending_confirm"
        )
      )
  );
  const rollbackDisabled = loading || saving || rollingBack || sending || hasActiveToolCalls;

  return (
    <>
      <div className={modalStyles.overlay} onMouseDown={onClose}>
      <div
        className={modalStyles.dialog}
        style={{ width: 520 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={modalStyles.header}>
          <span className={modalStyles.headerTitle}>模型设置</span>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className={modalStyles.body}>
          {loading ? (
            <div className={modalStyles.hint}>正在读取配置...</div>
          ) : (
            <>
              <label className={modalStyles.field}>
                <span className={modalStyles.label}>服务商名称</span>
                <input
                  className="input"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                />
              </label>
              <label className={modalStyles.field}>
                <span className={modalStyles.label}>Base URL</span>
                <input
                  className="input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://open.bigmodel.cn"
                />
              </label>
              <div className={modalStyles.row}>
                <label className={`${modalStyles.field} ${modalStyles.grow}`}>
                  <span className={modalStyles.label}>模型</span>
                  <input
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="glm-5.2"
                  />
                </label>
                <label className={`${modalStyles.field} ${modalStyles.grow}`}>
                  <span className={modalStyles.label}>Completions Path</span>
                  <input
                    className="input"
                    value={completionsPath}
                    onChange={(e) => setCompletionsPath(e.target.value)}
                    placeholder="/v1/chat/completions"
                  />
                </label>
              </div>
              <label className={modalStyles.field}>
                <span className={modalStyles.label}>API Key</span>
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyConfigured ? "留空表示沿用已保存 Key" : "首次配置必须填写"}
                />
              </label>
              {rollbackAvailable && rollbackConfig && (
                <div className={modalStyles.rollbackBox}>
                  <div className={modalStyles.rollbackTitle}>上一版模型配置</div>
                  <div className={modalStyles.rollbackSummary}>
                    <span>服务商：{rollbackConfig.providerName || "未命名"}</span>
                    <span>模型：{rollbackConfig.model || "未填写"}</span>
                    <span>Base URL：{rollbackConfig.baseUrl || "未填写"}</span>
                    <span>API Key：{rollbackConfig.apiKeyConfigured ? "已配置" : "未配置"}</span>
                  </div>
                  <div className={modalStyles.rollbackAction}>
                    <span className={modalStyles.hint}>回滚会丢弃未保存修改并新建会话</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={requestRollback}
                      disabled={rollbackDisabled}
                      title={
                        sending || hasActiveToolCalls
                          ? "当前 AI 会话正在进行中"
                          : "回滚到上一版配置"
                      }
                    >
                      {rollingBack ? "回滚中..." : "回滚上一版"}
                    </button>
                  </div>
                </div>
              )}
              {error && <div className={modalStyles.error}>{error}</div>}
            </>
          )}
        </div>
        <div className={modalStyles.footer}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn" onClick={requestSave} disabled={loading || saving || rollingBack}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
      </div>
      {archiveConfirmOpen && (
        <ConfirmDialog
          message="保存模型配置将结束所有当前 AI 会话。原对话会保留为只读历史，并自动新建空白会话。是否继续？"
          confirmText="结束会话并保存"
          cancelText="取消"
          onResolve={(ok) => {
            setArchiveConfirmOpen(false);
            if (ok) void doSave();
          }}
        />
      )}
      {rollbackConfirmOpen && (
        <ConfirmDialog
          message="回滚将丢弃当前未保存的修改，结束当前 AI 会话并恢复上一版模型配置。是否继续？"
          confirmText="回滚并新建会话"
          cancelText="取消"
          onResolve={(ok) => {
            setRollbackConfirmOpen(false);
            if (ok) void doRollback();
          }}
        />
      )}
    </>
  );
}
