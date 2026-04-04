import { z } from "zod";

import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "./runtime-plan.js";

export const SandboxdStartupModes = {
  NEW: "new",
  EXISTING: "existing",
} as const;

export const SandboxdStartupModeSchema = z.enum([
  SandboxdStartupModes.NEW,
  SandboxdStartupModes.EXISTING,
]);

export type SandboxdStartupMode = z.infer<typeof SandboxdStartupModeSchema>;

export const SandboxdStartupInputSchema = z
  .object({
    startupMode: SandboxdStartupModeSchema,
    bootstrapToken: z.string().min(1),
    tunnelExchangeToken: z.string().min(1),
    tunnelGatewayWsUrl: z.string().min(1),
    runtimePlan: CompiledRuntimePlanSchema,
    egressGrantByRuleId: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type SandboxdStartupInput = z.infer<typeof SandboxdStartupInputSchema>;

export const SandboxdStartupApplyRequestSchema = z
  .object({
    token: z.string().min(1),
    startupInput: SandboxdStartupInputSchema,
  })
  .strict();

export type SandboxdStartupApplyRequest = z.infer<typeof SandboxdStartupApplyRequestSchema>;

export const SandboxdStartupApplyResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

export type SandboxdStartupApplyResponse = z.infer<typeof SandboxdStartupApplyResponseSchema>;

function normalizeRequiredString(value: string, fieldLabel: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${fieldLabel} is required`);
  }

  return trimmedValue;
}

function readRequiredStringField(payload: object, fieldName: string): string {
  const fieldValue = Object.getOwnPropertyDescriptor(payload, fieldName)?.value;
  if (typeof fieldValue !== "string") {
    throw new Error(`startup input ${fieldName} is required`);
  }

  return fieldValue;
}

function readRequiredStartupModeField(payload: object): SandboxdStartupMode {
  const startupMode = Object.getOwnPropertyDescriptor(payload, "startupMode")?.value;
  if (startupMode === SandboxdStartupModes.NEW || startupMode === SandboxdStartupModes.EXISTING) {
    return startupMode;
  }

  throw new Error("startup input startupMode is required");
}

function readRequiredRuntimePlanField(payload: object): CompiledRuntimePlan {
  const runtimePlan = Object.getOwnPropertyDescriptor(payload, "runtimePlan")?.value;
  if (runtimePlan === undefined) {
    throw new Error("startup input runtime plan is required");
  }

  const parsedRuntimePlan = CompiledRuntimePlanSchema.safeParse(runtimePlan);
  if (!parsedRuntimePlan.success) {
    const firstIssue = parsedRuntimePlan.error.issues[0];
    throw new Error(
      `startup input runtime plan is invalid: ${firstIssue?.message ?? "invalid runtime plan"}`,
    );
  }

  return parsedRuntimePlan.data;
}

function readRequiredEgressGrantByRuleIdField(
  payload: object,
  runtimePlan: CompiledRuntimePlan,
): Record<string, string> {
  const egressGrantByRuleIdValue = Object.getOwnPropertyDescriptor(
    payload,
    "egressGrantByRuleId",
  )?.value;
  if (
    typeof egressGrantByRuleIdValue !== "object" ||
    egressGrantByRuleIdValue === null ||
    Array.isArray(egressGrantByRuleIdValue)
  ) {
    throw new Error("startup input egressGrantByRuleId is required");
  }

  const expectedRuleIds = new Set(runtimePlan.egressRoutes.map((route) => route.egressRuleId));
  const egressGrantByRuleId: Record<string, string> = {};

  for (const [ruleId, grant] of Object.entries(egressGrantByRuleIdValue)) {
    if (!expectedRuleIds.has(ruleId)) {
      throw new Error(`startup input egressGrantByRuleId has unexpected grant key ${ruleId}`);
    }

    if (typeof grant !== "string" || grant.trim().length === 0) {
      throw new Error(`startup input egressGrantByRuleId.${ruleId} is required`);
    }

    egressGrantByRuleId[ruleId] = grant.trim();
  }

  for (const route of runtimePlan.egressRoutes) {
    if (egressGrantByRuleId[route.egressRuleId] === undefined) {
      throw new Error(
        `startup input egressGrantByRuleId is missing grant for route ${route.egressRuleId}`,
      );
    }
  }

  return egressGrantByRuleId;
}

function validateExpectedFields(payload: object): void {
  const allowedFields = new Set([
    "startupMode",
    "bootstrapToken",
    "tunnelExchangeToken",
    "tunnelGatewayWsUrl",
    "runtimePlan",
    "egressGrantByRuleId",
  ]);

  for (const fieldName of Object.keys(payload)) {
    if (!allowedFields.has(fieldName)) {
      throw new Error(`startup input from stdin must be valid json: unexpected field ${fieldName}`);
    }
  }
}

export function parseSandboxdStartupInputPayload(payload: unknown): SandboxdStartupInput {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup input from stdin must be valid json: expected object");
  }

  validateExpectedFields(payload);

  const runtimePlan = readRequiredRuntimePlanField(payload);

  return {
    startupMode: readRequiredStartupModeField(payload),
    bootstrapToken: normalizeRequiredString(
      readRequiredStringField(payload, "bootstrapToken"),
      "startup input bootstrapToken",
    ),
    tunnelExchangeToken: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelExchangeToken"),
      "startup input tunnelExchangeToken",
    ),
    tunnelGatewayWsUrl: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelGatewayWsUrl"),
      "startup input tunnelGatewayWsUrl",
    ),
    runtimePlan,
    egressGrantByRuleId: readRequiredEgressGrantByRuleIdField(payload, runtimePlan),
  };
}

export function parseSandboxdStartupApplyRequestPayload(
  payload: unknown,
): SandboxdStartupApplyRequest {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup apply request must be valid json: expected object");
  }

  const allowedFields = new Set(["token", "startupInput"]);
  for (const fieldName of Object.keys(payload)) {
    if (!allowedFields.has(fieldName)) {
      throw new Error(`startup apply request must be valid json: unexpected field ${fieldName}`);
    }
  }

  const rawToken = Object.getOwnPropertyDescriptor(payload, "token")?.value;
  if (typeof rawToken !== "string") {
    throw new Error("startup apply request token is required");
  }

  const rawStartupInput = Object.getOwnPropertyDescriptor(payload, "startupInput")?.value;
  try {
    return {
      token: normalizeRequiredString(rawToken, "startup apply request token"),
      startupInput: parseSandboxdStartupInputPayload(rawStartupInput),
    };
  } catch (error) {
    throw new Error(
      `startup apply request startupInput is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseSandboxdStartupApplyResponsePayload(
  payload: unknown,
): SandboxdStartupApplyResponse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup apply response must be valid json: expected object");
  }

  const rawOk = Object.getOwnPropertyDescriptor(payload, "ok")?.value;
  if (typeof rawOk !== "boolean") {
    throw new Error("startup apply response ok is required");
  }

  if (rawOk) {
    return {
      ok: true,
    };
  }

  const rawError = Object.getOwnPropertyDescriptor(payload, "error")?.value;
  if (typeof rawError !== "string") {
    throw new Error("startup apply response error is required");
  }

  return {
    ok: false,
    error: normalizeRequiredString(rawError, "startup apply response error"),
  };
}
