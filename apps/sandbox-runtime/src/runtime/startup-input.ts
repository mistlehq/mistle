import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";

export const RuntimeStartupModes = {
  NEW: "new",
  EXISTING: "existing",
} as const;

export type RuntimeStartupMode = (typeof RuntimeStartupModes)[keyof typeof RuntimeStartupModes];

export type StartupInput = {
  // `new` performs initial provisioning from the runtime plan. `existing`
  // reuses the sandbox filesystem as-is and only restarts processes/tunnel.
  startupMode: RuntimeStartupMode;
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: CompiledRuntimePlan;
  egressGrantByRuleId: Record<string, string>;
};

function normalizeRequiredString(value: string, fieldLabel: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`startup input ${fieldLabel} is required`);
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

function readRequiredStartupModeField(payload: object): RuntimeStartupMode {
  const startupMode = Object.getOwnPropertyDescriptor(payload, "startupMode")?.value;
  if (startupMode === RuntimeStartupModes.NEW || startupMode === RuntimeStartupModes.EXISTING) {
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

    egressGrantByRuleId[ruleId] = grant;
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

export function parseStartupInputPayload(payload: unknown): StartupInput {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup input from stdin must be valid json: expected object");
  }

  validateExpectedFields(payload);

  const runtimePlan = readRequiredRuntimePlanField(payload);

  return {
    startupMode: readRequiredStartupModeField(payload),
    bootstrapToken: normalizeRequiredString(
      readRequiredStringField(payload, "bootstrapToken"),
      "bootstrap token",
    ),
    tunnelExchangeToken: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelExchangeToken"),
      "tunnel exchange token",
    ),
    tunnelGatewayWsUrl: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelGatewayWsUrl"),
      "tunnel gateway ws url",
    ),
    runtimePlan,
    egressGrantByRuleId: readRequiredEgressGrantByRuleIdField(payload, runtimePlan),
  };
}
