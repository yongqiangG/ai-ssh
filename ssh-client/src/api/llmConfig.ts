import { http } from "./request";

export interface LlmConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  completionsPath: string;
  apiKeyConfigured: boolean;
}

export interface LlmConfigSaveResult extends LlmConfig {
  configChanged: boolean;
  runnerReloadRequired: boolean;
  runnerRebuilt: boolean;
}

export interface SaveLlmConfigRequest {
  providerName: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  completionsPath: string;
  keepExistingApiKey: boolean;
}

export function getLlmConfig(): Promise<LlmConfig> {
  return http.get<LlmConfig>("/api/v1/llm-config");
}

export function saveLlmConfig(req: SaveLlmConfigRequest): Promise<LlmConfigSaveResult> {
  return http.post<LlmConfigSaveResult>("/api/v1/llm-config", req);
}
