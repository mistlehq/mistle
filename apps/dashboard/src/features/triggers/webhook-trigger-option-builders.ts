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
import { formatCompactSandboxProfileVersion } from "../sandbox-profiles/sandbox-profile-version-labels.js";
import type {
  SandboxProfile,
  SandboxProfileRepositoryOption,
  SandboxProfileVersionIntegrationBinding,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { createSyntheticWebhookTriggerEventOption } from "./webhook-trigger-event-option-availability.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventOptionAvailability,
} from "./webhook-trigger-event-types.js";
import type { WebhookTriggerFormOption } from "./webhook-trigger-form-types.js";

export const WebhookTriggerWorkspaceRootRepositoryOptionValue = "__workspace_root__";

function sortOptionsByLabel<T extends { label: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function formatWebhookTriggerEventGroupLabel(input: {
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

function formatWebhookTriggerSourceLabel(input: {
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

export function createWebhookTriggerEventId(input: {
  webhookSourceId: string;
  eventType: string;
}): string {
  return `${input.webhookSourceId}::${input.eventType}`;
}

export function createWebhookTriggerEventOption(input: {
  eventDefinition: IntegrationWebhookEventDefinition;
  webhookSourceId: string;
  connectionId: string;
  connectionLabel: string;
  availability?: WebhookTriggerEventOptionAvailability;
  logoKey?: string;
  categoryPrefix?: string;
}): WebhookTriggerEventOption {
  const category =
    input.eventDefinition.category === undefined
      ? undefined
      : input.categoryPrefix === undefined
        ? input.eventDefinition.category
        : `${input.categoryPrefix} / ${input.eventDefinition.category}`;

  return {
    id: createWebhookTriggerEventId({
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

export function buildWebhookTriggerConnectionOptions(input: {
  connections: readonly IntegrationConnection[];
  preservedConnectionId?: string;
  targets: readonly IntegrationTarget[];
}): readonly WebhookTriggerFormOption[] {
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

export function buildWebhookTriggerSandboxProfileOptions(input: {
  sandboxProfiles: readonly SandboxProfile[];
}): readonly WebhookTriggerFormOption[] {
  return sortOptionsByLabel(
    input.sandboxProfiles.map((profile) => ({
      value: profile.id,
      label: formatWebhookTriggerSandboxProfileOptionLabel({
        displayName: profile.displayName,
        version: profile.activeVersion,
      }),
      sandboxProfileDisplayName: profile.displayName,
      sandboxProfileVersion: profile.activeVersion,
    })),
  );
}

export function withSelectedSandboxProfileOptionVersion<
  TOption extends {
    value: string;
    label: string;
    sandboxProfileDisplayName?: string;
    sandboxProfileVersion?: number | null;
  },
>(input: {
  options: readonly TOption[];
  selectedProfileId: string;
  selectedVersion: number | null;
}): readonly TOption[] {
  if (input.selectedProfileId.length === 0 || input.selectedVersion === null) {
    return input.options;
  }

  let didUpdate = false;
  const options = input.options.map((option) => {
    if (
      option.value !== input.selectedProfileId ||
      option.sandboxProfileDisplayName === undefined
    ) {
      return option;
    }

    didUpdate = true;
    return {
      ...option,
      label: formatWebhookTriggerSandboxProfileOptionLabel({
        displayName: option.sandboxProfileDisplayName,
        version: input.selectedVersion,
      }),
      sandboxProfileVersion: input.selectedVersion,
    };
  });

  return didUpdate ? options : input.options;
}

function formatWebhookTriggerSandboxProfileOptionLabel(input: {
  displayName: string;
  version: number | null;
}): string {
  return input.version === null
    ? input.displayName
    : `${input.displayName} ${formatCompactSandboxProfileVersion(input.version)}`;
}

export function buildWebhookTriggerPrimaryRepositoryOptions(input: {
  repositoryOptions: readonly SandboxProfileRepositoryOption[];
}): readonly WebhookTriggerFormOption[] {
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
      value: WebhookTriggerWorkspaceRootRepositoryOptionValue,
      label: "None",
      path: "workspace root",
    },
    ...repositoryOptions,
  ];
}

export function resolveEligibleProfileTriggerConnectionIds(input: {
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

export function buildWebhookTriggerEventOptions(input: {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
  preservedConnectionId?: string;
  selectableConnectionIds?: readonly string[];
  selectedEventIds: readonly string[];
}): readonly WebhookTriggerEventOption[] {
  const selectedEventIds = new Set(input.selectedEventIds);
  const selectableConnectionIds =
    input.selectableConnectionIds === undefined ? null : new Set(input.selectableConnectionIds);
  const selectableConnections = input.connections.filter(
    (connection) => connection.status === "active" || connection.id === input.preservedConnectionId,
  );

  const supportedEventOptions = buildSelectableWebhookTriggerEventOptions({
    connections: selectableConnections,
    targets: input.targets,
    webhookSources: input.webhookSources,
    selectableConnectionIds,
  });

  const missingEventOptions = input.selectedEventIds
    .filter(
      (selectedTriggerId) =>
        !supportedEventOptions.some((eventOption) => eventOption.id === selectedTriggerId),
    )
    .map((selectedTriggerId) =>
      buildUnavailableSelectedWebhookTriggerEventOption({
        selectedTriggerId,
        connections: selectableConnections,
        targets: input.targets,
        webhookSources: input.webhookSources,
        selectableConnectionIds,
      }),
    );

  return [...supportedEventOptions, ...missingEventOptions].sort((left, right) => {
    const leftSelected = selectedEventIds.has(left.id);
    const rightSelected = selectedEventIds.has(right.id);
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

function buildSelectableWebhookTriggerEventOptions(input: {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
  selectableConnectionIds: ReadonlySet<string> | null;
}): WebhookTriggerEventOption[] {
  const supportedEventOptions: WebhookTriggerEventOption[] = [];

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
          createWebhookTriggerEventOption({
            eventDefinition,
            webhookSourceId: source.id,
            connectionId: connection.id,
            connectionLabel: formatWebhookTriggerEventGroupLabel({
              integrationDisplayName: target.displayName,
              connectionDisplayName: formatWebhookTriggerSourceLabel({
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

function buildUnavailableSelectedWebhookTriggerEventOption(input: {
  selectedTriggerId: string;
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
  selectableConnectionIds: ReadonlySet<string> | null;
}): WebhookTriggerEventOption {
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
  const availability = resolveUnavailableSelectedWebhookTriggerEventOptionAvailability({
    connection,
    target,
    selectableConnectionIds: input.selectableConnectionIds,
  });

  return createSyntheticWebhookTriggerEventOption({
    triggerId: input.selectedTriggerId,
    availability,
    ...(target === undefined || connection === undefined
      ? {}
      : {
          connectionLabel: formatWebhookTriggerEventGroupLabel({
            integrationDisplayName: target.displayName,
            connectionDisplayName: connection.displayName,
          }),
        }),
    ...(eventDefinition === undefined ? {} : { label: eventDefinition.displayName }),
  });
}

function resolveUnavailableSelectedWebhookTriggerEventOptionAvailability(input: {
  connection: IntegrationConnection | undefined;
  target: IntegrationTarget | undefined;
  selectableConnectionIds: ReadonlySet<string> | null;
}): Exclude<WebhookTriggerEventOptionAvailability, "available"> {
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
