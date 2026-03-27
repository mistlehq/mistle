import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxProfileVersionIntegrationBinding } from "../sandbox-profiles/sandbox-profiles-types.js";
import { createSyntheticWebhookAutomationEventOption } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationFormOption,
} from "./webhook-automation-form.js";
import type { WebhookAutomationEventOptionAvailability } from "./webhook-automation-trigger-types.js";

function sortOptionsByLabel<T extends { label: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function formatWebhookAutomationTriggerGroupLabel(input: {
  integrationDisplayName: string;
  connectionDisplayName: string;
}): string {
  const integrationDisplayName = input.integrationDisplayName.trim();
  const connectionDisplayName = input.connectionDisplayName.trim();

  if (integrationDisplayName.length === 0) {
    return connectionDisplayName;
  }

  if (
    connectionDisplayName.length === 0 ||
    connectionDisplayName.localeCompare(integrationDisplayName, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    return integrationDisplayName;
  }

  return `${integrationDisplayName} - ${connectionDisplayName}`;
}

export function createWebhookAutomationTriggerId(input: {
  connectionId: string;
  eventType: string;
}): string {
  return `${input.connectionId}::${input.eventType}`;
}

export function buildWebhookAutomationConnectionOptions(input: {
  connections: readonly IntegrationConnection[];
  preservedConnectionId?: string;
  targets: readonly IntegrationTarget[];
}): readonly WebhookAutomationFormOption[] {
  return sortOptionsByLabel(
    input.connections
      .filter(
        (connection) =>
          connection.status === "active" || connection.id === input.preservedConnectionId,
      )
      .map((connection) => {
        const target = input.targets.find((item) => item.targetKey === connection.targetKey);
        return {
          value: connection.id,
          label: connection.displayName,
          ...(target === undefined ? {} : { description: target.displayName }),
        };
      }),
  );
}

export function buildWebhookAutomationSandboxProfileOptions(input: {
  sandboxProfiles: readonly SandboxProfile[];
}): readonly WebhookAutomationFormOption[] {
  return sortOptionsByLabel(
    input.sandboxProfiles.map((profile) => ({
      value: profile.id,
      label: profile.displayName,
    })),
  );
}

export function resolveEligibleProfileAutomationConnectionIds(input: {
  bindings: readonly SandboxProfileVersionIntegrationBinding[];
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
}): readonly string[] {
  const eligibleConnectionIds = new Set<string>();

  for (const binding of input.bindings) {
    const connection = input.connections.find((candidate) => candidate.id === binding.connectionId);
    if (connection === undefined) {
      continue;
    }

    const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
    if ((target?.supportedWebhookEvents?.length ?? 0) === 0) {
      continue;
    }

    eligibleConnectionIds.add(connection.id);
  }

  return [...eligibleConnectionIds];
}

export function buildWebhookAutomationEventOptions(input: {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  preservedConnectionId?: string;
  selectableConnectionIds?: readonly string[];
  selectedTriggerIds: readonly string[];
}): readonly WebhookAutomationEventOption[] {
  const selectedTriggerIds = new Set(input.selectedTriggerIds);
  const selectableConnectionIds =
    input.selectableConnectionIds === undefined ? null : new Set(input.selectableConnectionIds);
  const selectableConnections = input.connections.filter(
    (connection) => connection.status === "active" || connection.id === input.preservedConnectionId,
  );

  const supportedEventOptions = buildSelectableWebhookAutomationEventOptions({
    connections: selectableConnections,
    targets: input.targets,
    selectableConnectionIds,
  });

  const missingEventOptions = input.selectedTriggerIds
    .filter(
      (selectedTriggerId) =>
        !supportedEventOptions.some((eventOption) => eventOption.id === selectedTriggerId),
    )
    .map((selectedTriggerId) =>
      buildUnavailableSelectedWebhookAutomationEventOption({
        selectedTriggerId,
        connections: selectableConnections,
        targets: input.targets,
        selectableConnectionIds,
      }),
    );

  return [...supportedEventOptions, ...missingEventOptions].sort((left, right) => {
    const leftSelected = selectedTriggerIds.has(left.id);
    const rightSelected = selectedTriggerIds.has(right.id);
    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1;
    }

    const leftCategory = left.category ?? "";
    const rightCategory = right.category ?? "";
    const categoryComparison = leftCategory.localeCompare(rightCategory);
    if (categoryComparison !== 0) {
      return categoryComparison;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildSelectableWebhookAutomationEventOptions(input: {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  selectableConnectionIds: ReadonlySet<string> | null;
}): WebhookAutomationEventOption[] {
  const supportedEventOptions: WebhookAutomationEventOption[] = [];

  for (const connection of input.connections) {
    if (
      input.selectableConnectionIds !== null &&
      !input.selectableConnectionIds.has(connection.id)
    ) {
      continue;
    }

    const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
    if (target === undefined) {
      continue;
    }

    for (const eventDefinition of target.supportedWebhookEvents ?? []) {
      supportedEventOptions.push({
        id: createWebhookAutomationTriggerId({
          connectionId: connection.id,
          eventType: eventDefinition.eventType,
        }),
        eventType: eventDefinition.eventType,
        connectionId: connection.id,
        connectionLabel: formatWebhookAutomationTriggerGroupLabel({
          integrationDisplayName: target.displayName,
          connectionDisplayName: connection.displayName,
        }),
        label: eventDefinition.displayName,
        availability: "available",
        ...(target.logoKey === undefined ? {} : { logoKey: target.logoKey }),
        ...(eventDefinition.conversationKeyOptions === undefined
          ? {}
          : {
              conversationKeyOptions: eventDefinition.conversationKeyOptions.map(
                (conversationKeyOption) => ({
                  id: conversationKeyOption.id,
                  label: conversationKeyOption.label,
                  description: conversationKeyOption.description,
                  template: conversationKeyOption.template,
                }),
              ),
            }),
        ...(eventDefinition.category === undefined
          ? {}
          : { category: `${connection.displayName} / ${eventDefinition.category}` }),
        ...(eventDefinition.parameters === undefined
          ? {}
          : {
              parameters: eventDefinition.parameters.map((parameter) =>
                parameter.kind === "resource-select"
                  ? {
                      id: parameter.id,
                      label: parameter.label,
                      kind: parameter.kind,
                      resourceKind: parameter.resourceKind,
                      payloadPath: [...parameter.payloadPath],
                      ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
                      ...(parameter.placeholder === undefined
                        ? {}
                        : { placeholder: parameter.placeholder }),
                    }
                  : parameter.kind === "enum-select"
                    ? {
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
                        ...(parameter.placeholder === undefined
                          ? {}
                          : { placeholder: parameter.placeholder }),
                      }
                    : {
                        id: parameter.id,
                        label: parameter.label,
                        kind: parameter.kind,
                        payloadPath: [...parameter.payloadPath],
                        ...(parameter.matchMode === undefined
                          ? {}
                          : { matchMode: parameter.matchMode }),
                        ...(parameter.defaultValue === undefined
                          ? {}
                          : { defaultValue: parameter.defaultValue }),
                        ...(parameter.defaultEnabled === undefined
                          ? {}
                          : { defaultEnabled: parameter.defaultEnabled }),
                        ...(parameter.controlVariant === undefined
                          ? {}
                          : { controlVariant: parameter.controlVariant }),
                        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
                        ...(parameter.placeholder === undefined
                          ? {}
                          : { placeholder: parameter.placeholder }),
                      },
              ),
            }),
      });
    }
  }

  return supportedEventOptions;
}

function buildUnavailableSelectedWebhookAutomationEventOption(input: {
  selectedTriggerId: string;
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  selectableConnectionIds: ReadonlySet<string> | null;
}): WebhookAutomationEventOption {
  const [connectionId = "", ...eventTypeParts] = input.selectedTriggerId.split("::");
  const eventType = eventTypeParts.join("::");
  const connection = input.connections.find((candidate) => candidate.id === connectionId);
  const target =
    connection === undefined
      ? undefined
      : input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
  const eventDefinition = target?.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === eventType,
  );
  const availability = resolveUnavailableSelectedWebhookAutomationEventOptionAvailability({
    connection,
    target,
    selectableConnectionIds: input.selectableConnectionIds,
  });

  return createSyntheticWebhookAutomationEventOption({
    triggerId: input.selectedTriggerId,
    availability,
    ...(target === undefined || connection === undefined
      ? {}
      : {
          connectionLabel: formatWebhookAutomationTriggerGroupLabel({
            integrationDisplayName: target.displayName,
            connectionDisplayName: connection.displayName,
          }),
        }),
    ...(eventDefinition === undefined ? {} : { label: eventDefinition.displayName }),
  });
}

function resolveUnavailableSelectedWebhookAutomationEventOptionAvailability(input: {
  connection: IntegrationConnection | undefined;
  target: IntegrationTarget | undefined;
  selectableConnectionIds: ReadonlySet<string> | null;
}): Exclude<WebhookAutomationEventOptionAvailability, "available"> {
  if (
    input.selectableConnectionIds !== null &&
    input.connection !== undefined &&
    input.target !== undefined &&
    !input.selectableConnectionIds.has(input.connection.id)
  ) {
    return "wrong_profile";
  }

  return "missing_integration";
}
