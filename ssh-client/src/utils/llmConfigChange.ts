import type { LlmConfig, SaveLlmConfigRequest } from "../api/llmConfig";

export type LlmConfigChangeKind = "no_change" | "metadata_only" | "runner_reload";

const norm = (v: string | undefined | null) => (v ?? "").trim();

export function classifyLlmConfigChange(
  current: Pick<LlmConfig, "providerName" | "baseUrl" | "model" | "completionsPath" | "apiKeyConfigured">,
  draft: Partial<Pick<SaveLlmConfigRequest, "apiKey" | "keepExistingApiKey">> &
    Pick<SaveLlmConfigRequest, "providerName" | "baseUrl" | "model" | "completionsPath">
): LlmConfigChangeKind {
  const providerChanged = norm(current.providerName) !== norm(draft.providerName);
  const baseUrlChanged = norm(current.baseUrl) !== norm(draft.baseUrl);
  const modelChanged = norm(current.model) !== norm(draft.model);
  const completionsPathChanged = norm(current.completionsPath) !== norm(draft.completionsPath);
  const apiKeyProvided = Boolean(norm(draft.apiKey));

  if (baseUrlChanged || modelChanged || completionsPathChanged || apiKeyProvided) {
    return "runner_reload";
  }
  if (providerChanged) {
    return "metadata_only";
  }
  return "no_change";
}
