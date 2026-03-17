export const OpenAiAgentAdapterKeys = {
  OPENAI_CODEX: "openai-codex",
} as const;

export type OpenAiAgentAdapterKey =
  (typeof OpenAiAgentAdapterKeys)[keyof typeof OpenAiAgentAdapterKeys];
