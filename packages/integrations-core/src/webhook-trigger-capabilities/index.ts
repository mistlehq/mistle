import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookTriggerCapabilities,
  IntegrationWebhookTriggerProviderPermissionRequirement,
  IntegrationWebhookTriggerRequirementSet,
  IntegrationWebhookTriggerRequirements,
} from "../types/index.js";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "../types/index.js";

export type IntegrationWebhookTriggerCapabilityEventStatus = "enabled" | "not_enabled";

export type IntegrationWebhookTriggerCapabilityEvent = {
  eventDefinition: IntegrationWebhookEventDefinition;
  capabilities?: IntegrationWebhookTriggerCapabilities | undefined;
  missingRequirementSets: readonly IntegrationWebhookTriggerRequirementSet[];
  satisfiedRequirementSet?: IntegrationWebhookTriggerRequirementSet | undefined;
  status: IntegrationWebhookTriggerCapabilityEventStatus;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return Object.fromEntries(Object.entries(value));
}

function parseStringArray(value: unknown, fieldName: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Webhook trigger capabilities field '${fieldName}' must be an array.`);
  }

  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`Webhook trigger capabilities field '${fieldName}' must contain strings.`);
    }

    values.push(entry);
  }

  return values;
}

function parsePermission(value: unknown): IntegrationWebhookTriggerProviderPermissionRequirement {
  const record = toRecord(value);
  if (record === null) {
    throw new Error("Webhook trigger capability permissions must contain objects.");
  }

  const permission = record["permission"];
  if (typeof permission !== "string" || permission.trim().length === 0) {
    throw new Error("Webhook trigger capability permissions must include permission.");
  }

  const access = record["access"];
  if (access !== undefined && (typeof access !== "string" || access.trim().length === 0)) {
    throw new Error("Webhook trigger capability permission access must be a string.");
  }

  return {
    permission,
    ...(access === undefined ? {} : { access }),
  };
}

function parsePermissions(
  value: unknown,
): readonly IntegrationWebhookTriggerProviderPermissionRequirement[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Webhook trigger capabilities field 'permissions' must be an array.");
  }

  return value.map((entry) => parsePermission(entry));
}

export function parseWebhookTriggerCapabilitiesProviderMetadata(
  providerMetadata: Readonly<Record<string, unknown>>,
): IntegrationWebhookTriggerCapabilities | undefined {
  const capabilitiesValue =
    providerMetadata[IntegrationWebhookTriggerCapabilitiesProviderMetadataKey];
  if (capabilitiesValue === undefined) {
    return undefined;
  }

  const capabilities = toRecord(capabilitiesValue);
  if (capabilities === null) {
    throw new Error("Webhook trigger capabilities provider metadata must be an object.");
  }

  const events = parseStringArray(capabilities["events"], "events");
  const permissions = parsePermissions(capabilities["permissions"]);

  return {
    ...(events === undefined ? {} : { events }),
    ...(permissions === undefined ? {} : { permissions }),
  };
}

function hasEventCapability(input: {
  capabilities: IntegrationWebhookTriggerCapabilities;
  event: string;
}): boolean {
  return input.capabilities.events?.includes(input.event) ?? false;
}

function hasPermissionCapability(input: {
  capabilities: IntegrationWebhookTriggerCapabilities;
  permission: IntegrationWebhookTriggerProviderPermissionRequirement;
}): boolean {
  return (
    input.capabilities.permissions?.some(
      (candidate) =>
        candidate.permission === input.permission.permission &&
        (input.permission.access === undefined || candidate.access === input.permission.access),
    ) ?? false
  );
}

export function hasWebhookTriggerEventCapability(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  event: string;
}): boolean {
  if (input.capabilities === undefined) {
    return false;
  }

  return hasEventCapability({
    capabilities: input.capabilities,
    event: input.event,
  });
}

export function hasWebhookTriggerPermissionCapability(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  permission: IntegrationWebhookTriggerProviderPermissionRequirement;
}): boolean {
  if (input.capabilities === undefined) {
    return false;
  }

  return hasPermissionCapability({
    capabilities: input.capabilities,
    permission: input.permission,
  });
}

function isRequirementSetSatisfied(input: {
  capabilities: IntegrationWebhookTriggerCapabilities;
  requirementSet: IntegrationWebhookTriggerRequirements["anyOf"][number];
}): boolean {
  if (
    input.requirementSet.event !== undefined &&
    !hasEventCapability({
      capabilities: input.capabilities,
      event: input.requirementSet.event,
    })
  ) {
    return false;
  }

  for (const permission of input.requirementSet.permissions ?? []) {
    if (!hasPermissionCapability({ capabilities: input.capabilities, permission })) {
      return false;
    }
  }

  return true;
}

export function isWebhookTriggerSupportedByCapabilities(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  requirements: IntegrationWebhookTriggerRequirements | undefined;
}): boolean {
  if (input.requirements === undefined) {
    return true;
  }

  if (input.capabilities === undefined) {
    return false;
  }

  const capabilities = input.capabilities;
  return input.requirements.anyOf.some((requirementSet) =>
    isRequirementSetSatisfied({
      capabilities,
      requirementSet,
    }),
  );
}

export function resolveWebhookTriggerCapabilityEvents(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): readonly IntegrationWebhookTriggerCapabilityEvent[] {
  return input.supportedWebhookEvents.map((eventDefinition) => {
    const requirements = eventDefinition.requirements;
    if (requirements === undefined) {
      return {
        eventDefinition,
        ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
        missingRequirementSets: [],
        status: "enabled",
      };
    }

    if (input.capabilities === undefined) {
      return {
        eventDefinition,
        missingRequirementSets: requirements.anyOf,
        status: "not_enabled",
      };
    }

    const capabilities = input.capabilities;
    const satisfiedRequirementSet = requirements.anyOf.find((requirementSet) =>
      isRequirementSetSatisfied({
        capabilities,
        requirementSet,
      }),
    );

    if (satisfiedRequirementSet !== undefined) {
      return {
        eventDefinition,
        capabilities,
        missingRequirementSets: [],
        satisfiedRequirementSet,
        status: "enabled",
      };
    }

    return {
      eventDefinition,
      capabilities,
      missingRequirementSets: requirements.anyOf,
      status: "not_enabled",
    };
  });
}
