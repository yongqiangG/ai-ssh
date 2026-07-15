import { http } from "./request";

export interface LlmConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  completionsPath: string;
  apiKeyConfigured: boolean;
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

export function saveLlmConfig(req: SaveLlmConfigRequest): Promise<LlmConfig> {
  return http.post<LlmConfig>("/api/v1/llm-config", req);
}
