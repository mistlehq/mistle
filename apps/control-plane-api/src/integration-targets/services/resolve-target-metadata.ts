import type { IntegrationTarget as PersistedIntegrationTarget } from "@mistle/db/control-plane";
import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

type ResolvedWebhookEventParameter =
  | {
      id: string;
      label: string;
      kind: "resource-select";
      resourceKind: string;
      payloadPath: string[];
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "string";
      payloadPath: string[];
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "enum-select";
      payloadPath: string[];
      matchMode: "eq" | "exists";
      options: {
        value: string;
        label: string;
      }[];
      prefix?: string;
      placeholder?: string;
    };

type ResolvedWebhookEvent = {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category?: string;
  conversationKeyOptions?: {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
  parameters?: ResolvedWebhookEventParameter[];
};

export type ResolvedIntegrationTargetMetadata = {
  displayName: string;
  description: string;
  logoKey?: string;
  connectionMethods?: {
    id: "api-key" | "oauth2" | "github-app-installation";
    label: string;
    kind: "api-key" | "oauth2" | "redirect";
  }[];
  supportedWebhookEvents?: ResolvedWebhookEvent[];
};

function cloneWebhookEventParameters(
  parameters: readonly IntegrationWebhookEventParameterDefinition[],
): ResolvedWebhookEventParameter[] {
  return parameters.map((parameter) => cloneWebhookEventParameter(parameter));
}

function cloneWebhookEventConversationKeyOptions(
  options: NonNullable<IntegrationWebhookEventDefinition["conversationKeyOptions"]>,
): NonNullable<ResolvedWebhookEvent["conversationKeyOptions"]> {
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
    template: option.template,
  }));
}

function cloneWebhookEventParameter(
  parameter: IntegrationWebhookEventParameterDefinition,
): ResolvedWebhookEventParameter {
  if (parameter.kind === "resource-select") {
    return {
      id: parameter.id,
      label: parameter.label,
      kind: parameter.kind,
      resourceKind: parameter.resourceKind,
      payloadPath: [...parameter.payloadPath],
      ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
      ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
    };
  }

  if (parameter.kind === "enum-select") {
    return {
      id: parameter.id,
      label: parameter.label,
      kind: parameter.kind,
      payloadPath: [...parameter.payloadPath],
      matchMode: parameter.matchMode,
      options: parameter.options.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
      ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
    };
  }

  return {
    id: parameter.id,
    label: parameter.label,
    kind: parameter.kind,
    payloadPath: [...parameter.payloadPath],
    ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
    ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
  };
}

function cloneWebhookEvents(
  events: readonly IntegrationWebhookEventDefinition[],
): ResolvedWebhookEvent[] {
  return events.map((eventDefinition) => ({
    eventType: eventDefinition.eventType,
    providerEventType: eventDefinition.providerEventType,
    displayName: eventDefinition.displayName,
    ...(eventDefinition.category === undefined ? {} : { category: eventDefinition.category }),
    ...(eventDefinition.conversationKeyOptions === undefined
      ? {}
      : {
          conversationKeyOptions: cloneWebhookEventConversationKeyOptions(
            eventDefinition.conversationKeyOptions,
          ),
        }),
    ...(eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: cloneWebhookEventParameters(eventDefinition.parameters),
        }),
  }));
}

export function resolveTargetMetadata(input: {
  familyId: string;
  variantId: string;
  displayNameOverride: string | null;
  descriptionOverride: string | null;
}): ResolvedIntegrationTargetMetadata {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  if (definition === undefined) {
    if (input.displayNameOverride !== null && input.descriptionOverride !== null) {
      return {
        displayName: input.displayNameOverride,
        description: input.descriptionOverride,
      };
    }

    throw new Error(
      `Integration definition '${input.familyId}::${input.variantId}' was not found and target metadata overrides are incomplete.`,
    );
  }

  if (definition.description === undefined || definition.description.trim().length === 0) {
    if (input.descriptionOverride !== null) {
      return {
        displayName: input.displayNameOverride ?? definition.displayName,
        description: input.descriptionOverride,
        logoKey: definition.logoKey,
        connectionMethods: definition.connectionMethods.map((method) => ({
          id: method.id,
          label: method.label,
          kind: method.kind,
        })),
        ...(definition.supportedWebhookEvents === undefined
          ? {}
          : {
              supportedWebhookEvents: cloneWebhookEvents(definition.supportedWebhookEvents),
            }),
      };
    }

    throw new Error(
      `Integration definition '${input.familyId}::${input.variantId}' must provide a non-empty description.`,
    );
  }

  return {
    displayName: input.displayNameOverride ?? definition.displayName,
    description: input.descriptionOverride ?? definition.description,
    logoKey: definition.logoKey,
    connectionMethods: definition.connectionMethods.map((method) => ({
      id: method.id,
      label: method.label,
      kind: method.kind,
    })),
    ...(definition.supportedWebhookEvents === undefined
      ? {}
      : {
          supportedWebhookEvents: cloneWebhookEvents(definition.supportedWebhookEvents),
        }),
  };
}

export function resolveTargetMetadataFromPersistedTarget(
  target: Pick<
    PersistedIntegrationTarget,
    "familyId" | "variantId" | "displayNameOverride" | "descriptionOverride"
  >,
): ResolvedIntegrationTargetMetadata {
  return resolveTargetMetadata({
    familyId: target.familyId,
    variantId: target.variantId,
    displayNameOverride: target.displayNameOverride,
    descriptionOverride: target.descriptionOverride,
  });
}
