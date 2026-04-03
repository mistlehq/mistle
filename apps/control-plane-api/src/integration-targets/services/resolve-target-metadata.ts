import type { IntegrationTarget as PersistedIntegrationTarget } from "@mistle/db/control-plane";
import type {
  IntegrationConnectionMethodDefinition,
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

function getTargetDefinition(input: { familyId: string; variantId: string }) {
  return IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
}

export function hasTargetDefinition(input: { familyId: string; variantId: string }): boolean {
  return getTargetDefinition(input) !== undefined;
}

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
      matchMode?: "eq" | "contains" | "contains_token";
      defaultValue?: string;
      defaultEnabled?: boolean;
      controlVariant?: "explicit-invocation";
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
  payloadReferences?: {
    path: string[];
    description: string;
  }[];
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
  connectionMethods?: (
    | {
        id: string;
        label: string;
        kind: "form";
        secretFields: {
          name: string;
          label: string;
          placeholder?: string;
          description?: string;
          inputType: "password" | "text";
        }[];
      }
    | {
        id: string;
        label: string;
        kind: "redirect";
        ui: {
          create: {
            submitLabel: string;
            helperText: string;
          };
        };
      }
  )[];
  supportedWebhookEvents?: ResolvedWebhookEvent[];
};

function resolveConnectionMethod(
  method: IntegrationConnectionMethodDefinition,
): NonNullable<ResolvedIntegrationTargetMetadata["connectionMethods"]>[number] {
  if (method.kind === "form") {
    return {
      id: method.id,
      label: method.label,
      kind: "form",
      secretFields: method.secretFields.map((field) => ({
        name: field.name,
        label: field.label,
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.description === undefined ? {} : { description: field.description }),
        inputType: field.inputType,
      })),
    };
  }

  return {
    id: method.id,
    label: method.label,
    kind: "redirect",
    ui: method.ui,
  };
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
    ...(parameter.matchMode === undefined ? {} : { matchMode: parameter.matchMode }),
    ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue }),
    ...(parameter.defaultEnabled === undefined ? {} : { defaultEnabled: parameter.defaultEnabled }),
    ...(parameter.controlVariant === undefined ? {} : { controlVariant: parameter.controlVariant }),
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
    ...(eventDefinition.payloadReferences === undefined
      ? {}
      : {
          payloadReferences: eventDefinition.payloadReferences.map((payloadReference) => ({
            path: [...payloadReference.path],
            description: payloadReference.description,
          })),
        }),
    ...(eventDefinition.conversationKeyOptions === undefined
      ? {}
      : {
          conversationKeyOptions: eventDefinition.conversationKeyOptions.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            template: option.template,
          })),
        }),
    ...(eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: eventDefinition.parameters.map((parameter) =>
            cloneWebhookEventParameter(parameter),
          ),
        }),
  }));
}

export function resolveTargetMetadata(input: {
  familyId: string;
  variantId: string;
  displayNameOverride: string | null;
  descriptionOverride: string | null;
}): ResolvedIntegrationTargetMetadata {
  const definition = getTargetDefinition({
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
        connectionMethods: definition.connectionMethods.map((method) =>
          resolveConnectionMethod(method),
        ),
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
    connectionMethods: definition.connectionMethods.map((method) =>
      resolveConnectionMethod(method),
    ),
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
