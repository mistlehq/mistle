import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";
import {
  isWebhookTriggerSupportedByCapabilities,
  parseWebhookTriggerCapabilitiesProviderMetadata,
} from "@mistle/integrations-core";

import type {
  IntegrationConnection,
  IntegrationWebhookSource,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type {
  SandboxProfile,
  SandboxProfileRepositoryOption,
  SandboxProfileVersionIntegrationBinding,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { createSyntheticWebhookAutomationEventOption } from "./webhook-automation-event-option-availability.js";
import type { WebhookAutomationFormOption } from "./webhook-automation-form-types.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationEventOptionAvailability,
} from "./webhook-automation-trigger-types.js";

export const WebhookAutomationWorkspaceRootRepositoryOptionValue = "__workspace_root__";

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

function formatWebhookAutomationSourceLabel(input: {
  connectionDisplayName: string;
  sourceDisplayName: string;
  sourceCount: number;
}): string {
  if (input.sourceCount <= 1) {
    return input.connectionDisplayName;
  }

  const sourceDisplayName = input.sourceDisplayName.trim();
  if (sourceDisplayName.length === 0 || sourceDisplayName === input.connectionDisplayName) {
    return input.connectionDisplayName;
  }

  return `${input.connectionDisplayName} - ${sourceDisplayName}`;
}

export function createWebhookAutomationTriggerId(input: {
  webhookSourceId: string;
  eventType: string;
}): string {
  return `${input.webhookSourceId}::${input.eventType}`;
}

export function createWebhookAutomationEventOption(input: {
  eventDefinition: IntegrationWebhookEventDefinition;
  webhookSourceId: string;
  connectionId: string;
  connectionLabel: string;
  availability?: WebhookAutomationEventOptionAvailability;
  logoKey?: string;
  categoryPrefix?: string;
}): WebhookAutomationEventOption {
  const category =
    input.eventDefinition.category === undefined
      ? undefined
      : input.categoryPrefix === undefined
        ? input.eventDefinition.category
        : `${input.categoryPrefix} / ${input.eventDefinition.category}`;

  return {
    id: createWebhookAutomationTriggerId({
      webhookSourceId: input.webhookSourceId,
      eventType: input.eventDefinition.eventType,
    }),
    eventType: input.eventDefinition.eventType,
    integrationWebhookSourceId: input.webhookSourceId,
    connectionId: input.connectionId,
    connectionLabel: input.connectionLabel,
    label: input.eventDefinition.displayName,
    ...(input.availability === undefined ? {} : { availability: input.availability }),
    ...(input.logoKey === undefined ? {} : { logoKey: input.logoKey }),
    ...(input.eventDefinition.payloadReferences === undefined
      ? {}
      : {
          payloadReferences: input.eventDefinition.payloadReferences.map((payloadReference) => ({
            path: [...payloadReference.path],
            description: payloadReference.description,
          })),
        }),
    ...(input.eventDefinition.conversationKeyOptions === undefined
      ? {}
      : {
          conversationKeyOptions: input.eventDefinition.conversationKeyOptions.map(
            (conversationKeyOption) => ({
              id: conversationKeyOption.id,
              label: conversationKeyOption.label,
              description: conversationKeyOption.description,
              template: conversationKeyOption.template,
            }),
          ),
        }),
    ...(input.eventDefinition.requirements === undefined
      ? {}
      : { requirements: input.eventDefinition.requirements }),
    ...(category === undefined ? {} : { category }),
    ...(input.eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: input.eventDefinition.parameters.map((parameter) =>
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
  };
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

export function buildWebhookAutomationPrimaryRepositoryOptions(input: {
  repositoryOptions: readonly SandboxProfileRepositoryOption[];
}): readonly WebhookAutomationFormOption[] {
  if (input.repositoryOptions.length === 0) {
    return [];
  }

  const repositoryOptions = sortOptionsByLabel(
    input.repositoryOptions.map((option) => ({
      value: option.id,
      label: option.label,
      path: option.path,
    })),
  );

  return [
    {
      value: WebhookAutomationWorkspaceRootRepositoryOptionValue,
      label: "None",
      path: "workspace root",
    },
    ...repositoryOptions,
  ];
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
  webhookSources: readonly IntegrationWebhookSource[];
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
    webhookSources: input.webhookSources,
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
        webhookSources: input.webhookSources,
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
  webhookSources: readonly IntegrationWebhookSource[];
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

    const connectionWebhookSources = input.webhookSources.filter(
      (candidate) =>
        candidate.integrationConnectionId === connection.id && candidate.status === "active",
    );
    if (connectionWebhookSources.length === 0) {
      continue;
    }

    for (const source of connectionWebhookSources) {
      const webhookTriggerCapabilities = parseWebhookTriggerCapabilitiesProviderMetadata(
        source.providerMetadata,
      );

      for (const eventDefinition of target.supportedWebhookEvents ?? []) {
        if (
          !isWebhookTriggerSupportedByCapabilities({
            capabilities: webhookTriggerCapabilities,
            requirements: eventDefinition.requirements,
          })
        ) {
          continue;
        }

        supportedEventOptions.push(
          createWebhookAutomationEventOption({
            eventDefinition,
            webhookSourceId: source.id,
            connectionId: connection.id,
            connectionLabel: formatWebhookAutomationTriggerGroupLabel({
              integrationDisplayName: target.displayName,
              connectionDisplayName: formatWebhookAutomationSourceLabel({
                connectionDisplayName: connection.displayName,
                sourceDisplayName: source.displayName,
                sourceCount: connectionWebhookSources.length,
              }),
            }),
            availability: "available",
            ...(target.logoKey === undefined ? {} : { logoKey: target.logoKey }),
            categoryPrefix:
              connectionWebhookSources.length > 1
                ? `${connection.displayName} / ${source.displayName}`
                : connection.displayName,
          }),
        );
      }
    }
  }

  return supportedEventOptions;
}

function buildUnavailableSelectedWebhookAutomationEventOption(input: {
  selectedTriggerId: string;
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
  selectableConnectionIds: ReadonlySet<string> | null;
}): WebhookAutomationEventOption {
  const [integrationWebhookSourceId = "", ...eventTypeParts] = input.selectedTriggerId.split("::");
  const eventType = eventTypeParts.join("::");
  const source = input.webhookSources.find(
    (candidate) => candidate.id === integrationWebhookSourceId,
  );
  const connection =
    source?.integrationConnectionId === undefined
      ? undefined
      : input.connections.find((candidate) => candidate.id === source.integrationConnectionId);
  const target =
    source === undefined
      ? undefined
      : input.targets.find((candidate) => candidate.targetKey === source.targetKey);
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
