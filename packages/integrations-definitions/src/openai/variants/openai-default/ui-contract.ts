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
