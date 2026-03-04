type UnknownRecord = Record<string, unknown>;

const OPENAI_RUNTIME_CODEX_CLI = "codex-cli";

export type OpenAiReasoningEffort = "low" | "medium" | "high" | "xhigh";
const OPENAI_REASONING_VALUES: readonly OpenAiReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];
export type OpenAiAuthScheme = "api-key" | "oauth";

export type OpenAiCapabilitySet = {
  models: readonly string[];
  allowedReasoningByModel: Record<string, readonly OpenAiReasoningEffort[]>;
  defaultReasoningByModel: Record<string, OpenAiReasoningEffort>;
  reasoningLabels: Record<OpenAiReasoningEffort, string>;
};

export type OpenAiResolvedBindingUi = {
  openaiAgent?:
    | {
        kind: "agent";
        runtime: "codex-cli";
        familyId: "openai";
        variantId: "openai-default";
        byAuthScheme: Record<OpenAiAuthScheme, OpenAiCapabilitySet>;
      }
    | undefined;
};

export type OpenAiAgentBindingConfig = {
  runtime: "codex-cli";
  defaultModel: string;
  reasoningEffort: OpenAiReasoningEffort;
};

function isReasoningEffort(value: string): value is OpenAiReasoningEffort {
  return OPENAI_REASONING_VALUES.some((candidate) => candidate === value);
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

export function readOpenAiAuthScheme(
  connectionConfig: Record<string, unknown> | undefined,
): OpenAiAuthScheme | undefined {
  if (connectionConfig === undefined) {
    return undefined;
  }
  const authScheme = readString(connectionConfig, "auth_scheme");
  if (authScheme === "api-key" || authScheme === "oauth") {
    return authScheme;
  }
  return undefined;
}

export function resolveOpenAiCapabilitySet(input: {
  resolvedBindingUi: OpenAiResolvedBindingUi | undefined;
  authScheme: OpenAiAuthScheme;
}): OpenAiCapabilitySet | undefined {
  const openAiAgent = input.resolvedBindingUi?.openaiAgent;
  if (openAiAgent === undefined) {
    return undefined;
  }
  return openAiAgent.byAuthScheme[input.authScheme];
}

export function parseOpenAiAgentBindingConfig(
  config: Record<string, unknown>,
): OpenAiAgentBindingConfig | undefined {
  const runtime = readString(config, "runtime");
  const defaultModel = readString(config, "defaultModel");
  const reasoningEffort = readString(config, "reasoningEffort");
  if (
    runtime !== OPENAI_RUNTIME_CODEX_CLI ||
    defaultModel === undefined ||
    reasoningEffort === undefined
  ) {
    return undefined;
  }
  if (!isReasoningEffort(reasoningEffort)) {
    return undefined;
  }
  return {
    runtime,
    defaultModel,
    reasoningEffort,
  };
}

export function createDefaultOpenAiBindingConfig(input: {
  capabilitySet: OpenAiCapabilitySet | undefined;
}): OpenAiAgentBindingConfig | undefined {
  const capabilitySet = input.capabilitySet;
  if (capabilitySet === undefined) {
    return undefined;
  }
  const defaultModel = capabilitySet.models[0];
  if (defaultModel === undefined) {
    return undefined;
  }
  const reasoningEffort = capabilitySet.defaultReasoningByModel[defaultModel];
  if (reasoningEffort === undefined) {
    return undefined;
  }
  return {
    runtime: OPENAI_RUNTIME_CODEX_CLI,
    defaultModel,
    reasoningEffort,
  };
}
