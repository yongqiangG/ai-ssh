import { useEffect, useState } from "react";
import { getLlmConfig, saveLlmConfig } from "../api/llmConfig";
import { useChatStore } from "../stores/chatStore";
import Icon from "./Icon";
import modalStyles from "./sshConnectionModal.module.css";

interface LlmSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LlmSettingsModal({ open, onClose }: LlmSettingsModalProps) {
  const [providerName, setProviderName] = useState("OpenAI Compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [completionsPath, setCompletionsPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setApiKey("");
    getLlmConfig()
      .then((config) => {
        setProviderName(config.providerName || "OpenAI Compatible");
        setBaseUrl(config.baseUrl || "");
        setModel(config.model || "");
        setCompletionsPath(config.completionsPath || "");
        setApiKeyConfigured(Boolean(config.apiKeyConfigured));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveLlmConfig({
        providerName,
        baseUrl,
        apiKey,
        model,
        completionsPath,
        keepExistingApiKey: apiKeyConfigured && !apiKey.trim(),
      });
      await useChatStore.getState().loadAgents();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
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
              {error && <div className={modalStyles.error}>{error}</div>}
            </>
          )}
        </div>
        <div className={modalStyles.footer}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn" onClick={save} disabled={loading || saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
