import { z } from "zod";

export const OpencodeBridgeJsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UPSTREAM_REQUEST_FAILED: -32000,
} as const;

export const OpencodeBridgeMethodNames = {
  CONVERSATION_CREATE: "conversation.create",
  CONVERSATION_INSPECT: "conversation.inspect",
  CONVERSATION_RESUME: "conversation.resume",
  EXECUTION_START: "execution.start",
  EXECUTION_STEER: "execution.steer",
  EXECUTION_INTERRUPT: "execution.interrupt",
} as const;

export const ProviderConversationStatuses = {
  IDLE: "idle",
  ACTIVE: "active",
  ERROR: "error",
} as const;

export const OpencodeBridgeConversationInspectResultSchema = z.object({
  exists: z.boolean(),
  status: z.enum([
    ProviderConversationStatuses.IDLE,
    ProviderConversationStatuses.ACTIVE,
    ProviderConversationStatuses.ERROR,
  ]),
  activeExecutionId: z.string().nullable(),
});

export const OpencodeBridgeConversationCreateParamsSchema = z.object({
  options: z.record(z.string(), z.unknown()).optional(),
});

export const OpencodeBridgeConversationCreateResultSchema = z.object({
  providerConversationId: z.string().min(1),
  providerState: z.unknown().optional(),
});

export const OpencodeBridgeConversationInspectParamsSchema = z.object({
  providerConversationId: z.string().min(1),
});

export const OpencodeBridgeConversationResumeParamsSchema =
  OpencodeBridgeConversationInspectParamsSchema;

export const OpencodeBridgeExecutionStartParamsSchema = z.object({
  providerConversationId: z.string().min(1),
  inputText: z.string().min(1),
});

export const OpencodeBridgeExecutionSteerParamsSchema = z.object({
  providerConversationId: z.string().min(1),
  providerExecutionId: z.string().min(1),
  inputText: z.string().min(1),
});

export const OpencodeBridgeExecutionInterruptParamsSchema = z.object({
  providerConversationId: z.string().min(1),
  providerExecutionId: z.string().min(1),
});

export const OpencodeBridgeExecutionResultSchema = z.object({
  providerExecutionId: z.string().min(1),
});

export type OpencodeBridgeConversationInspectResult = z.output<
  typeof OpencodeBridgeConversationInspectResultSchema
>;

export type OpencodeBridgeConversationCreateResult = z.output<
  typeof OpencodeBridgeConversationCreateResultSchema
>;

export type OpencodeBridgeExecutionResult = z.output<typeof OpencodeBridgeExecutionResultSchema>;
