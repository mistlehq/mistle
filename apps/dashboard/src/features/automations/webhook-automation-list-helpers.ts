import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxProfileVersionIntegrationBinding } from "../sandbox-profiles/sandbox-profiles-types.js";
import { formatRelativeOrDate } from "../shared/date-formatters.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationFormOption,
} from "./webhook-automation-form.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-view.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

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

export function formatWebhookAutomationUpdatedAt(isoDateTime: string): string {
  return formatRelativeOrDate(isoDateTime);
}

function summarizeEventTypes(eventTypes: readonly string[] | null): string {
  if (eventTypes === null || eventTypes.length === 0) {
    return "All events";
  }

  return eventTypes.join(", ");
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
  selectedTriggerIds: readonly string[];
}): readonly WebhookAutomationEventOption[] {
  const selectedTriggerIds = new Set(input.selectedTriggerIds);
  const eligibleConnections = input.connections.filter(
    (connection) => connection.status === "active" || connection.id === input.preservedConnectionId,
  );

  const supportedEventOptions: WebhookAutomationEventOption[] = [];

  for (const connection of eligibleConnections) {
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

  const missingEventOptions = input.selectedTriggerIds
    .filter(
      (selectedTriggerId) =>
        !supportedEventOptions.some((eventOption) => eventOption.id === selectedTriggerId),
    )
    .map((selectedTriggerId) => {
      const [connectionId = "", ...eventTypeParts] = selectedTriggerId.split("::");
      const eventType = eventTypeParts.join("::");

      return {
        id: selectedTriggerId,
        eventType,
        connectionId,
        connectionLabel: connectionId,
        label: eventType,
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        unavailable: true,
      } satisfies WebhookAutomationEventOption;
    });

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

export function buildWebhookAutomationListItems(input: {
  automations: readonly WebhookAutomation[];
  connections: readonly IntegrationConnection[];
  sandboxProfiles: readonly SandboxProfile[];
}): readonly WebhookAutomationListItemViewModel[] {
  return input.automations.map((automation) => {
    const connection = input.connections.find(
      (candidate) => candidate.id === automation.integrationConnectionId,
    );
    const sandboxProfile = input.sandboxProfiles.find(
      (candidate) => candidate.id === automation.target.sandboxProfileId,
    );

    return {
      id: automation.id,
      name: automation.name,
      integrationConnectionName: connection?.displayName ?? automation.integrationConnectionId,
      sandboxProfileName: sandboxProfile?.displayName ?? automation.target.sandboxProfileId,
      eventSummary: summarizeEventTypes(automation.eventTypes),
      updatedAtLabel: formatWebhookAutomationUpdatedAt(automation.updatedAt),
      enabled: automation.enabled,
    };
  });
}
