import { z } from "zod";

import { OpenAiModelIds, OpenAiReasoningEfforts } from "./model-capabilities.js";

const OpenAiAuthSchemeSchema = z.enum(["api-key", "oauth"]);
const OpenAiReasoningEffortSchema = z.enum([
  OpenAiReasoningEfforts.LOW,
  OpenAiReasoningEfforts.MEDIUM,
  OpenAiReasoningEfforts.HIGH,
  OpenAiReasoningEfforts.XHIGH,
]);
const OpenAiModelIdSchema = z.enum(OpenAiModelIds);

const OpenAiCapabilitySetProjectionSchema = z
  .object({
    models: z.array(OpenAiModelIdSchema).readonly(),
    allowedReasoningByModel: z.record(
      OpenAiModelIdSchema,
      z.array(OpenAiReasoningEffortSchema).min(1).readonly(),
    ),
    defaultReasoningByModel: z.record(OpenAiModelIdSchema, OpenAiReasoningEffortSchema),
    reasoningLabels: z.record(OpenAiReasoningEffortSchema, z.string().min(1)),
  })
  .strict();

const OpenAiAgentBindingConfigSchema = z
  .object({
    runtime: z.literal("codex-cli"),
    defaultModel: z.string().min(1),
    reasoningEffort: OpenAiReasoningEffortSchema,
  })
  .strict();

export const OpenAiTargetUiProjectionSchema = z
  .object({
    openaiAgent: z
      .object({
        kind: z.literal("agent"),
        runtime: z.literal("codex-cli"),
        familyId: z.literal("openai"),
        variantId: z.literal("openai-default"),
        byAuthScheme: z.record(OpenAiAuthSchemeSchema, OpenAiCapabilitySetProjectionSchema),
      })
      .strict(),
  })
  .strict();

export type OpenAiAuthScheme = z.output<typeof OpenAiAuthSchemeSchema>;
export type OpenAiReasoningEffort = z.output<typeof OpenAiReasoningEffortSchema>;
export type OpenAiCapabilitySet = {
  models: readonly string[];
  allowedReasoningByModel: Record<string, readonly OpenAiReasoningEffort[]>;
  defaultReasoningByModel: Record<string, OpenAiReasoningEffort>;
  reasoningLabels: Record<OpenAiReasoningEffort, string>;
};
export type OpenAiAgentBindingConfig = z.output<typeof OpenAiAgentBindingConfigSchema>;
export type OpenAiTargetUiProjection = z.output<typeof OpenAiTargetUiProjectionSchema>;

export function parseOpenAiTargetUiProjection(
  input: unknown,
): OpenAiTargetUiProjection | undefined {
  const parsed = OpenAiTargetUiProjectionSchema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function mapStrictCapabilitySetToUiCapabilitySet(
  capabilitySet: OpenAiTargetUiProjection["openaiAgent"]["byAuthScheme"][OpenAiAuthScheme],
): OpenAiCapabilitySet {
  const allowedReasoningByModel: Record<string, readonly OpenAiReasoningEffort[]> = {};
  for (const [modelId, reasoningOptions] of Object.entries(capabilitySet.allowedReasoningByModel)) {
    allowedReasoningByModel[modelId] = reasoningOptions;
  }

  const defaultReasoningByModel: Record<string, OpenAiReasoningEffort> = {};
  for (const [modelId, defaultReasoning] of Object.entries(capabilitySet.defaultReasoningByModel)) {
    defaultReasoningByModel[modelId] = defaultReasoning;
  }

  return {
    models: capabilitySet.models,
    allowedReasoningByModel,
    defaultReasoningByModel,
    reasoningLabels: capabilitySet.reasoningLabels,
  };
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
  resolvedBindingUi: Record<string, unknown> | undefined;
  authScheme: OpenAiAuthScheme;
}): OpenAiCapabilitySet | undefined {
  const parsedProjection = parseOpenAiTargetUiProjection(input.resolvedBindingUi);
  if (parsedProjection === undefined) {
    return undefined;
  }

  return mapStrictCapabilitySetToUiCapabilitySet(
    parsedProjection.openaiAgent.byAuthScheme[input.authScheme],
  );
}

export function parseOpenAiAgentBindingConfig(
  config: Record<string, unknown>,
): OpenAiAgentBindingConfig | undefined {
  const parsed = OpenAiAgentBindingConfigSchema.safeParse(config);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
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
    runtime: "codex-cli",
    defaultModel,
    reasoningEffort,
  };
}
