import {
  ConversationProviderFamilies,
  type ControlPlaneDatabase,
  IntegrationBindingKinds,
  type ConversationProviderFamily,
} from "@mistle/db/control-plane";

export const AutomationTargetDeliveryConfigErrorCodes = {
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  AUTOMATION_TARGET_BINDING_AMBIGUOUS: "automation_target_binding_ambiguous",
  AUTOMATION_TARGET_BINDING_MISSING: "automation_target_binding_missing",
  AUTOMATION_TARGET_BINDING_INVALID: "automation_target_binding_invalid",
  AUTOMATION_TARGET_PROVIDER_UNSUPPORTED: "automation_target_provider_unsupported",
} as const;

export class AutomationTargetDeliveryConfigError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProviderFamilyFromTargetFamily(targetFamilyId: string): ConversationProviderFamily {
  if (targetFamilyId === "openai") {
    return ConversationProviderFamilies.CODEX;
  }

  throw new AutomationTargetDeliveryConfigError({
    code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_PROVIDER_UNSUPPORTED,
    message: `Automation target uses unsupported integration family '${targetFamilyId}' for conversation delivery.`,
  });
}

function resolveProviderModelFromBindingConfig(config: unknown): string {
  if (!isRecord(config)) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config must be an object.",
    });
  }

  const defaultModelValue = config.defaultModel;
  if (typeof defaultModelValue !== "string" || defaultModelValue.trim().length === 0) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config.defaultModel must be a non-empty string.",
    });
  }

  return defaultModelValue;
}

export type AutomationTargetDeliveryConfig = {
  automationTargetId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  providerFamily: ConversationProviderFamily;
  providerModel: string;
};

export async function loadAutomationTargetDeliveryConfig(
  db: ControlPlaneDatabase,
  input: {
    automationTargetId: string;
  },
): Promise<AutomationTargetDeliveryConfig> {
  const automationTarget = await db.query.automationTargets.findFirst({
    where: (table, { eq }) => eq(table.id, input.automationTargetId),
  });
  if (automationTarget === undefined) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_NOT_FOUND,
      message: `Automation target '${input.automationTargetId}' was not found.`,
    });
  }

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (sandboxProfileVersion === null) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, automationTarget.sandboxProfileId),
        eq(table.sandboxProfileVersion, sandboxProfileVersion),
        eq(table.kind, IntegrationBindingKinds.AGENT),
      ),
  });
  if (agentBindings.length === 0) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: `Sandbox profile '${automationTarget.sandboxProfileId}' version '${String(sandboxProfileVersion)}' does not have an agent integration binding.`,
    });
  }
  if (agentBindings.length > 1) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_AMBIGUOUS,
      message: `Sandbox profile '${automationTarget.sandboxProfileId}' version '${String(sandboxProfileVersion)}' has multiple agent integration bindings.`,
    });
  }

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: "Expected an agent integration binding but none was available.",
    });
  }

  const bindingConnection = await db.query.integrationConnections.findFirst({
    where: (table, { eq }) => eq(table.id, agentBinding.connectionId),
  });
  if (bindingConnection === undefined) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Integration binding '${agentBinding.id}' references missing connection '${agentBinding.connectionId}'.`,
    });
  }

  const bindingTarget = await db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, bindingConnection.targetKey),
  });
  if (bindingTarget === undefined) {
    throw new AutomationTargetDeliveryConfigError({
      code: AutomationTargetDeliveryConfigErrorCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Integration binding '${agentBinding.id}' references missing target '${bindingConnection.targetKey}'.`,
    });
  }

  return {
    automationTargetId: automationTarget.id,
    sandboxProfileId: automationTarget.sandboxProfileId,
    sandboxProfileVersion,
    providerFamily: resolveProviderFamilyFromTargetFamily(bindingTarget.familyId),
    providerModel: resolveProviderModelFromBindingConfig(agentBinding.config),
  };
}
