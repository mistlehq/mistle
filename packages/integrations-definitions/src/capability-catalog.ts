import type {
  AnyIntegrationDefinition,
  IntegrationConnectionMethodDefinition,
  IntegrationConnectionMethodKind,
  IntegrationFormConnectionMethodSetupCompletionRequirement,
  IntegrationRegistry,
  IntegrationWebhookEventParameterDefinition,
} from "@mistle/integrations-core";

export const MistleSupportedCapabilityKinds = {
  INTEGRATION: "integration",
  PROVIDER_RESOURCE: "provider_resource",
  RUNTIME_TOOL: "runtime_tool",
  SETUP: "setup",
  TRIGGER_EVENT: "trigger_event",
} as const;

export type MistleSupportedCapabilityKind =
  (typeof MistleSupportedCapabilityKinds)[keyof typeof MistleSupportedCapabilityKinds];

export type MistleSupportedCapabilitiesInput = {
  capabilityKind?: MistleSupportedCapabilityKind | undefined;
  includeDetails?: boolean | undefined;
  providerFamilyId?: string | undefined;
};

export type MistleSupportedCapabilitiesResult = {
  items: MistleSupportedIntegrationCapability[];
};

export type MistleSupportedIntegrationCapability = {
  capabilities: {
    integration: {
      connectionMethodCount: number;
      connectionMethods?: MistleSupportedConnectionMethod[] | undefined;
    };
    providerResources: {
      resourceKindCount: number;
      resources?: MistleSupportedProviderResource[] | undefined;
      syncTriggers?: MistleSupportedResourceSyncTrigger[] | undefined;
    };
    runtimeTools: {
      mcpSupported: boolean;
    };
    setup: {
      connectionSetupSupported: boolean;
      providerAppSetupSupported: boolean;
      providerConfigurationSetupSupported: boolean;
      webhookSourceSupported: boolean;
    };
    triggerEvents: {
      eventCount: number;
      events?: MistleSupportedTriggerEvent[] | undefined;
    };
    associatedResourceEvents: {
      eventCount: number;
      events?: MistleSupportedAssociatedResourceEvent[] | undefined;
    };
  };
  description?: string | undefined;
  displayName: string;
  familyId: string;
  kind: string;
  logoKey: string;
  variantId: string;
};

export type MistleSupportedConnectionMethod = {
  createBehavior?: string | undefined;
  id: string;
  kind: IntegrationConnectionMethodKind;
  label: string;
  setup?:
    | {
        completionRequirements?: MistleSupportedSetupCompletionRequirement | undefined;
        providerAppSetup: boolean;
        providerConfigurationSetup: boolean;
        requiresWebhookCallbackUrl: boolean;
        routeSegment: string;
      }
    | undefined;
};

export type MistleSupportedSetupCompletionRequirement =
  IntegrationFormConnectionMethodSetupCompletionRequirement;

export type MistleSupportedProviderResource = {
  bindingField: string;
  description?: string | undefined;
  displayNamePlural: string;
  displayNameSingular: string;
  kind: string;
  selectionMode: string;
};

export type MistleSupportedResourceSyncTrigger = {
  eventType: string;
  resourceKinds: readonly string[];
};

export type MistleSupportedTriggerEvent = {
  category?: string | undefined;
  displayName: string;
  eventType: string;
  parameterGroups?: readonly MistleSupportedTriggerEventParameterGroup[] | undefined;
  parameters?: readonly MistleSupportedTriggerEventParameter[] | undefined;
  providerEventType: string;
  requirements?:
    | {
        anyOf: readonly MistleSupportedTriggerRequirementSet[];
      }
    | undefined;
};

export type MistleSupportedTriggerEventParameter = {
  id: string;
  kind: IntegrationWebhookEventParameterDefinition["kind"];
  label: string;
  resourceKind?: string | undefined;
};

export type MistleSupportedTriggerEventParameterGroup = {
  id: string;
  kind: "oneOf";
  label: string;
  options: readonly {
    label: string;
    parameterId: string;
  }[];
};

export type MistleSupportedTriggerRequirementSet = {
  event?: string | undefined;
  label?: string | undefined;
  permissions?: readonly {
    access?: string | undefined;
    permission: string;
  }[];
};

export type MistleSupportedAssociatedResourceEvent = {
  displayName: string;
  eventType: string;
  resourceKind: string;
};

export function listSupportedCapabilities(
  registry: IntegrationRegistry,
  input: MistleSupportedCapabilitiesInput = {},
): MistleSupportedCapabilitiesResult {
  const includeDetails = input.includeDetails === true;
  const items = registry
    .listDefinitions()
    .filter((definition) => matchesProviderFamily(definition, input.providerFamilyId))
    .map((definition) => buildSupportedIntegrationCapability(definition, { includeDetails }))
    .filter((capability) => matchesCapabilityKind(capability, input.capabilityKind));

  return { items };
}

function matchesProviderFamily(
  definition: AnyIntegrationDefinition,
  providerFamilyId: string | undefined,
): boolean {
  return providerFamilyId === undefined || definition.familyId === providerFamilyId;
}

function matchesCapabilityKind(
  capability: MistleSupportedIntegrationCapability,
  capabilityKind: MistleSupportedCapabilityKind | undefined,
): boolean {
  if (capabilityKind === undefined) {
    return true;
  }

  if (capabilityKind === MistleSupportedCapabilityKinds.INTEGRATION) {
    return capability.capabilities.integration.connectionMethodCount > 0;
  }

  if (capabilityKind === MistleSupportedCapabilityKinds.PROVIDER_RESOURCE) {
    return capability.capabilities.providerResources.resourceKindCount > 0;
  }

  if (capabilityKind === MistleSupportedCapabilityKinds.RUNTIME_TOOL) {
    return capability.capabilities.runtimeTools.mcpSupported;
  }

  if (capabilityKind === MistleSupportedCapabilityKinds.SETUP) {
    const setup = capability.capabilities.setup;
    return (
      setup.connectionSetupSupported ||
      setup.providerAppSetupSupported ||
      setup.providerConfigurationSetupSupported ||
      setup.webhookSourceSupported
    );
  }

  if (capabilityKind === MistleSupportedCapabilityKinds.TRIGGER_EVENT) {
    return capability.capabilities.triggerEvents.eventCount > 0;
  }

  const exhaustiveCapabilityKind: never = capabilityKind;
  return exhaustiveCapabilityKind;
}

function buildSupportedIntegrationCapability(
  definition: AnyIntegrationDefinition,
  input: { includeDetails: boolean },
): MistleSupportedIntegrationCapability {
  const supportedWebhookEvents = definition.supportedWebhookEvents ?? [];
  const associatedResourceEvents = definition.associatedResourceEvents?.supportedEvents ?? [];
  const resourceDefinitions = definition.resourceDefinitions ?? [];
  const resourceSyncTriggers = definition.resourceSyncTriggers ?? [];
  const setup = buildSetupSummary(definition);

  return {
    familyId: definition.familyId,
    variantId: definition.variantId,
    kind: definition.kind,
    displayName: definition.displayName,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    logoKey: definition.logoKey,
    capabilities: {
      integration: {
        connectionMethodCount: definition.connectionMethods.length,
        ...(input.includeDetails
          ? {
              connectionMethods: definition.connectionMethods.map((method) =>
                buildConnectionMethod(method),
              ),
            }
          : {}),
      },
      runtimeTools: {
        mcpSupported: definition.mcp !== undefined,
      },
      triggerEvents: {
        eventCount: supportedWebhookEvents.length,
        ...(input.includeDetails
          ? {
              events: supportedWebhookEvents.map((event) => ({
                eventType: event.eventType,
                providerEventType: event.providerEventType,
                displayName: event.displayName,
                ...(event.category === undefined ? {} : { category: event.category }),
                ...(event.parameters === undefined
                  ? {}
                  : {
                      parameters: event.parameters.map((parameter) =>
                        buildTriggerEventParameter(parameter),
                      ),
                    }),
                ...(event.parameterGroups === undefined
                  ? {}
                  : {
                      parameterGroups: event.parameterGroups.map((group) => ({
                        id: group.id,
                        label: group.label,
                        kind: group.kind,
                        options: group.options.map((option) => ({
                          parameterId: option.parameterId,
                          label: option.label,
                        })),
                      })),
                    }),
                ...(event.requirements === undefined
                  ? {}
                  : {
                      requirements: {
                        anyOf: event.requirements.anyOf.map((requirementSet) => ({
                          ...(requirementSet.label === undefined
                            ? {}
                            : { label: requirementSet.label }),
                          ...(requirementSet.event === undefined
                            ? {}
                            : { event: requirementSet.event }),
                          ...(requirementSet.permissions === undefined
                            ? {}
                            : {
                                permissions: requirementSet.permissions.map((permission) => ({
                                  permission: permission.permission,
                                  ...(permission.access === undefined
                                    ? {}
                                    : { access: permission.access }),
                                })),
                              }),
                        })),
                      },
                    }),
              })),
            }
          : {}),
      },
      providerResources: {
        resourceKindCount: resourceDefinitions.length,
        ...(input.includeDetails
          ? {
              resources: resourceDefinitions.map((resource) => ({
                kind: resource.kind,
                selectionMode: resource.selectionMode,
                bindingField: resource.bindingField,
                displayNameSingular: resource.displayNameSingular,
                displayNamePlural: resource.displayNamePlural,
                ...(resource.description === undefined
                  ? {}
                  : { description: resource.description }),
              })),
              syncTriggers: resourceSyncTriggers.map((trigger) => ({
                eventType: trigger.eventType,
                resourceKinds: trigger.resourceKinds,
              })),
            }
          : {}),
      },
      associatedResourceEvents: {
        eventCount: associatedResourceEvents.length,
        ...(input.includeDetails
          ? {
              events: associatedResourceEvents.map((event) => ({
                eventType: event.eventType,
                resourceKind: event.resourceKind,
                displayName: event.displayName,
              })),
            }
          : {}),
      },
      setup,
    },
  };
}

function buildSetupSummary(definition: AnyIntegrationDefinition): {
  connectionSetupSupported: boolean;
  providerAppSetupSupported: boolean;
  providerConfigurationSetupSupported: boolean;
  webhookSourceSupported: boolean;
} {
  const connectionSetupSupported = definition.connectionMethods.some(
    (method) => method.kind === "form" && method.setupFlow !== undefined,
  );

  return {
    connectionSetupSupported,
    providerAppSetupSupported: definition.providerAppSetup !== undefined,
    providerConfigurationSetupSupported: definition.providerConfigurationSetup !== undefined,
    webhookSourceSupported: definition.webhookSource !== undefined,
  };
}

function buildConnectionMethod(
  method: IntegrationConnectionMethodDefinition,
): MistleSupportedConnectionMethod {
  return {
    id: method.id,
    label: method.label,
    kind: method.kind,
    ...(method.kind === "form" && method.createBehavior !== undefined
      ? { createBehavior: method.createBehavior }
      : {}),
    ...(method.kind === "form" && method.setupFlow !== undefined
      ? {
          setup: {
            routeSegment: method.setupFlow.routeSegment,
            providerAppSetup: method.setupFlow.providerAppSetup !== undefined,
            providerConfigurationSetup: method.setupFlow.providerConfigurationSetup !== undefined,
            requiresWebhookCallbackUrl:
              method.setupFlow.providerAppSetup?.urls.webhookCallback !== undefined ||
              method.setupFlow.providerConfigurationSetup?.webhookCallback !== undefined,
            ...(method.setupFlow.completionRequirements === undefined
              ? {}
              : {
                  completionRequirements: method.setupFlow.completionRequirements,
                }),
          },
        }
      : {}),
  };
}

function buildTriggerEventParameter(
  parameter: IntegrationWebhookEventParameterDefinition,
): MistleSupportedTriggerEventParameter {
  return {
    id: parameter.id,
    label: parameter.label,
    kind: parameter.kind,
    ...(parameter.kind === "resource-select" ? { resourceKind: parameter.resourceKind } : {}),
  };
}
