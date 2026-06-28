import {
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  listIntegrationConnectionResources,
  type IntegrationConnection,
  type IntegrationConnectionResource,
} from "../integrations/integrations-service.js";
import type {
  WebhookTriggerActorResourceAttributeDefinition,
  WebhookTriggerActorResourceDefinition,
  WebhookTriggerActorResourceRelationshipDefinition,
  WebhookTriggerEventOption,
} from "./webhook-trigger-event-types.js";
import { resolveWebhookTriggerEventOptionIdFromConditionId } from "./webhook-trigger-option-builders.js";
import type { WebhookTriggerActorPolicy } from "./webhook-triggers-types.js";

const ActorPolicyModes = {
  ANYONE: "anyone",
  ATTRIBUTE: "attribute",
  SPECIFIC: "specific",
  RELATIONSHIP: "relationship",
  CUSTOM: "custom",
} as const;

type ActorPolicyMode = (typeof ActorPolicyModes)[keyof typeof ActorPolicyModes];

type ActorPolicyMap = Record<string, WebhookTriggerActorPolicy>;

type AttributeActorPolicyOption = {
  id: string;
  label: string;
  description?: string;
  rule: WebhookTriggerActorPolicy["anyOf"][number];
};

type ActorPolicyResourceKind = {
  kind: string;
  label: string;
  summary: NonNullable<IntegrationConnection["resources"]>[number] | undefined;
};

type ActorSetPolicyOption = {
  id: string;
  label: string;
  description?: string;
  relationshipDefinition: WebhookTriggerActorResourceRelationshipDefinition;
  resourceKind: string;
  scopeKind: string;
  summary: NonNullable<IntegrationConnection["resources"]>[number] | undefined;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatResourceKindLabel(input: {
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
  kind: string;
  plural: boolean;
}): string {
  const definition = input.resourceDefinitions?.find((candidate) => candidate.kind === input.kind);
  if (definition === undefined) {
    return input.kind;
  }

  return input.plural ? definition.displayNamePlural : definition.displayNameSingular;
}

function formatSyncStatus(
  summary: NonNullable<IntegrationConnection["resources"]>[number] | undefined,
): string {
  if (summary === undefined) {
    return "Not synced";
  }

  if (summary.syncState === "ready") {
    const lastSynced =
      summary.lastSyncedAt === undefined ? "" : ` Last synced ${summary.lastSyncedAt}.`;
    return `${summary.count} synced.${lastSynced}`;
  }

  if (summary.syncState === "syncing") {
    return "Syncing.";
  }

  if (summary.syncState === "error") {
    return summary.lastErrorMessage ?? "Sync failed.";
  }

  return "Not synced.";
}

function resolveActorResourceKinds(input: {
  connection: IntegrationConnection | undefined;
  eventOption: WebhookTriggerEventOption;
}): ActorPolicyResourceKind[] {
  const actorKinds = uniqueStrings(
    (input.eventOption.actor?.resourceReferences ?? []).map((reference) => reference.resourceKind),
  );

  return actorKinds.map((kind) => ({
    kind,
    label: formatResourceKindLabel({
      resourceDefinitions: input.eventOption.resourceDefinitions,
      kind,
      plural: false,
    }),
    summary: input.connection?.resources?.find((summary) => summary.kind === kind),
  }));
}

function resolveActorPolicyMode(policy: WebhookTriggerActorPolicy | undefined): ActorPolicyMode {
  if (policy === undefined) {
    return ActorPolicyModes.ANYONE;
  }

  const [rule] = policy.anyOf;
  if (rule === undefined || policy.anyOf.length !== 1) {
    return ActorPolicyModes.CUSTOM;
  }

  if (rule.kind === "resource") {
    return ActorPolicyModes.SPECIFIC;
  }

  if (rule.kind === "attribute") {
    return ActorPolicyModes.ATTRIBUTE;
  }

  return ActorPolicyModes.RELATIONSHIP;
}

function formatActorPolicyModeLabel(mode: ActorPolicyMode): string {
  if (mode === ActorPolicyModes.ANYONE) {
    return "Anyone";
  }

  if (mode === ActorPolicyModes.ATTRIBUTE) {
    return "Actor type";
  }

  if (mode === ActorPolicyModes.SPECIFIC) {
    return "Specific actor";
  }

  if (mode === ActorPolicyModes.RELATIONSHIP) {
    return "Group or set";
  }

  return "Custom actor policy";
}

function resolveSelectedResourceKind(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  actorResourceKinds: readonly ActorPolicyResourceKind[];
}): string {
  const [rule] = input.policy?.anyOf ?? [];
  if (rule?.kind === "resource") {
    return rule.actor.resourceKind;
  }

  return (
    input.actorResourceKinds.find((resourceKind) => resourceKind.summary?.syncState === "ready")
      ?.kind ??
    input.actorResourceKinds[0]?.kind ??
    ""
  );
}

function resolveSelectedActorSetOptionId(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  options: readonly ActorSetPolicyOption[];
}): string {
  const [rule] = input.policy?.anyOf ?? [];
  if (rule?.kind !== "relationship") {
    return input.options.find((option) => option.summary?.syncState === "ready")?.id ?? "";
  }

  return (
    input.options.find(
      (option) =>
        option.relationshipDefinition.relationshipKind === rule.relationshipKind &&
        option.resourceKind === rule.actorSet.resourceKind &&
        option.scopeKind === rule.scope.resourceKind,
    )?.id ??
    input.options.find((option) => option.summary?.syncState === "ready")?.id ??
    ""
  );
}

function removeActorPolicy(input: {
  conditionId: string;
  policies: ActorPolicyMap | undefined;
}): ActorPolicyMap {
  return Object.fromEntries(
    Object.entries(input.policies ?? {}).filter(
      ([conditionId]) => conditionId !== input.conditionId,
    ),
  );
}

function setActorPolicy(input: {
  conditionId: string;
  policies: ActorPolicyMap | undefined;
  policy: WebhookTriggerActorPolicy;
}): ActorPolicyMap {
  return {
    ...(input.policies ?? {}),
    [input.conditionId]: input.policy,
  };
}

function addSpecificActorPicker(input: {
  conditionId: string;
  openPickers: Record<string, true>;
}): Record<string, true> {
  return {
    ...input.openPickers,
    [input.conditionId]: true,
  };
}

function removeSpecificActorPicker(input: {
  conditionId: string;
  openPickers: Record<string, true>;
}): Record<string, true> {
  return Object.fromEntries(
    Object.entries(input.openPickers).filter(([conditionId]) => conditionId !== input.conditionId),
  );
}

function resolveAttributeOptions(input: {
  actorResourceKinds: readonly ActorPolicyResourceKind[];
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): AttributeActorPolicyOption[] {
  const options: AttributeActorPolicyOption[] = [];

  for (const actorResourceKind of input.actorResourceKinds) {
    if (actorResourceKind.summary?.syncState !== "ready") {
      continue;
    }

    const resourceDefinition = input.resourceDefinitions?.find(
      (definition) => definition.kind === actorResourceKind.kind,
    );

    for (const attributeDefinition of resourceDefinition?.attributeDefinitions ?? []) {
      if (attributeDefinition.actorPolicyEligible !== true) {
        continue;
      }

      options.push(
        ...createAttributeOptions({
          actorResourceKind,
          attributeDefinition,
        }),
      );
    }
  }

  return options;
}

function createAttributeOptions(input: {
  actorResourceKind: ActorPolicyResourceKind;
  attributeDefinition: WebhookTriggerActorResourceAttributeDefinition;
}): AttributeActorPolicyOption[] {
  if (input.attributeDefinition.valueType === "boolean") {
    return [
      {
        id: `${input.actorResourceKind.kind}:${input.attributeDefinition.key}:true`,
        label: `${input.attributeDefinition.displayName ?? input.attributeDefinition.key}: yes`,
        ...(input.attributeDefinition.description === undefined
          ? {}
          : { description: input.attributeDefinition.description }),
        rule: {
          kind: "attribute",
          attributeKey: input.attributeDefinition.key,
          attributeValue: "true",
          valueType: input.attributeDefinition.valueType,
        },
      },
      {
        id: `${input.actorResourceKind.kind}:${input.attributeDefinition.key}:false`,
        label: `${input.attributeDefinition.displayName ?? input.attributeDefinition.key}: no`,
        ...(input.attributeDefinition.description === undefined
          ? {}
          : { description: input.attributeDefinition.description }),
        rule: {
          kind: "attribute",
          attributeKey: input.attributeDefinition.key,
          attributeValue: "false",
          valueType: input.attributeDefinition.valueType,
        },
      },
    ];
  }

  return [];
}

function resolveSelectedAttributeOptionId(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  options: readonly AttributeActorPolicyOption[];
}): string {
  const [rule] = input.policy?.anyOf ?? [];
  if (rule?.kind !== "attribute") {
    return input.options[0]?.id ?? "";
  }

  return (
    input.options.find(
      (option) =>
        option.rule.kind === "attribute" &&
        option.rule.attributeKey === rule.attributeKey &&
        option.rule.attributeValue === rule.attributeValue &&
        option.rule.valueType === rule.valueType,
    )?.id ??
    input.options[0]?.id ??
    ""
  );
}

function resolveActorSetOptions(input: {
  actorResourceKinds: readonly ActorPolicyResourceKind[];
  connection: IntegrationConnection | undefined;
  eventOption: WebhookTriggerEventOption;
}): ActorSetPolicyOption[] {
  const actorKinds = new Set(input.actorResourceKinds.map((resourceKind) => resourceKind.kind));

  return (input.eventOption.resourceRelationshipDefinitions ?? [])
    .filter((definition) => actorKinds.has(definition.subjectResourceKind))
    .flatMap((definition) => {
      const scopeDefinition = definition.scopeDefinitions.find(
        (candidate) => candidate.scopeKind === definition.objectResourceKind,
      );
      if (scopeDefinition === undefined) {
        return [];
      }

      return [
        {
          id: `${definition.relationshipKind}:${definition.objectResourceKind}:${scopeDefinition.scopeKind}`,
          label:
            definition.displayName ??
            `${formatResourceKindLabel({
              resourceDefinitions: input.eventOption.resourceDefinitions,
              kind: definition.objectResourceKind,
              plural: false,
            })} members`,
          ...(definition.description === undefined ? {} : { description: definition.description }),
          relationshipDefinition: definition,
          resourceKind: definition.objectResourceKind,
          scopeKind: scopeDefinition.scopeKind,
          summary: input.connection?.resources?.find(
            (summary) => summary.kind === definition.objectResourceKind,
          ),
        },
      ];
    });
}

function SpecificActorPolicyFields(input: {
  actorResourceKinds: readonly ActorPolicyResourceKind[];
  conditionId: string;
  connectionId: string;
  disabled: boolean;
  policies: ActorPolicyMap | undefined;
  policy: WebhookTriggerActorPolicy | undefined;
  initialResourceKind: string;
  onPoliciesChange: (policies: ActorPolicyMap) => void;
  onResourceKindChanging: () => void;
  onSpecificActorSelected: () => void;
}): React.JSX.Element {
  const [selectedResourceKind, setSelectedResourceKind] = useState(input.initialResourceKind);
  const selectedKind = input.actorResourceKinds.find(
    (resourceKind) => resourceKind.kind === selectedResourceKind,
  );
  const selectedResourceId = resolveSelectedResourceId(input.policy);
  const resourcesQuery = useQuery({
    queryKey: ["trigger-actor-policy-resources", input.connectionId, selectedResourceKind],
    queryFn: ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: selectedResourceKind,
        signal,
      }),
    enabled: selectedKind?.summary?.syncState === "ready",
  });
  const resources = resourcesQuery.data?.items ?? [];

  return (
    <div className="space-y-2">
      <Select
        disabled={input.disabled}
        onValueChange={(value) => {
          if (value === null) {
            return;
          }

          setSelectedResourceKind(value);
          input.onResourceKindChanging();
          input.onPoliciesChange(
            removeActorPolicy({
              conditionId: input.conditionId,
              policies: input.policies,
            }),
          );
        }}
        value={selectedResourceKind}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Actor type">
            {selectedKind?.label ?? selectedResourceKind}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {input.actorResourceKinds.map((resourceKind) => (
            <SelectItem
              disabled={resourceKind.summary?.syncState !== "ready"}
              key={resourceKind.kind}
              value={resourceKind.kind}
            >
              <span>{resourceKind.label}</span>
              <span className="text-muted-foreground block text-xs">
                {formatSyncStatus(resourceKind.summary)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedKind?.summary?.syncState !== "ready" ? (
        <Notice>{formatSyncStatus(selectedKind?.summary)}</Notice>
      ) : (
        <Select
          disabled={input.disabled || resourcesQuery.isPending || resourcesQuery.isError}
          onValueChange={(resourceId) => {
            const selectedResource = resources.find((resource) => resource.id === resourceId);
            if (selectedResource === undefined) {
              return;
            }

            input.onPoliciesChange(
              setActorPolicy({
                conditionId: input.conditionId,
                policies: input.policies,
                policy: {
                  anyOf: [
                    {
                      kind: "resource",
                      actor: {
                        resourceKind: selectedResource.kind,
                        resourceId: selectedResource.id,
                      },
                    },
                  ],
                },
              }),
            );
            input.onSpecificActorSelected();
          }}
          value={selectedResourceId}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                resourcesQuery.isPending
                  ? "Loading actors..."
                  : resources.length === 0
                    ? "No synced actors"
                    : "Select actor"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {resources.map((resource) => (
              <SelectItem key={resource.id} value={resource.id}>
                <span>{resource.displayName}</span>
                <span className="text-muted-foreground block text-xs">{resource.handle}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {resourcesQuery.isError ? <Notice variant="alert">Could not load actors.</Notice> : null}
    </div>
  );
}

function resolveSelectedResourceId(policy: WebhookTriggerActorPolicy | undefined): string {
  const [rule] = policy?.anyOf ?? [];
  if (rule?.kind !== "resource" || !("resourceId" in rule.actor)) {
    return "";
  }

  return rule.actor.resourceId;
}

function resolveSelectedActorSetResourceId(policy: WebhookTriggerActorPolicy | undefined): string {
  const [rule] = policy?.anyOf ?? [];
  if (rule?.kind !== "relationship" || !("resourceId" in rule.actorSet)) {
    return "";
  }

  return rule.actorSet.resourceId;
}

function createRelationshipActorPolicy(input: {
  option: ActorSetPolicyOption;
  resource: IntegrationConnectionResource;
}): WebhookTriggerActorPolicy {
  return {
    anyOf: [
      {
        kind: "relationship",
        relationshipKind: input.option.relationshipDefinition.relationshipKind,
        actorSet: {
          resourceKind: input.resource.kind,
          resourceId: input.resource.id,
        },
        scope: {
          resourceKind: input.option.scopeKind,
          resourceId: input.resource.id,
        },
      },
    ],
  };
}

function RelationshipActorPolicyFields(input: {
  actorSetOptions: readonly ActorSetPolicyOption[];
  conditionId: string;
  connectionId: string;
  disabled: boolean;
  policies: ActorPolicyMap | undefined;
  policy: WebhookTriggerActorPolicy | undefined;
  initialOptionId: string;
  onPoliciesChange: (policies: ActorPolicyMap) => void;
  onActorSetOptionChanging: () => void;
  onActorSetSelected: () => void;
}): React.JSX.Element {
  const [selectedOptionId, setSelectedOptionId] = useState(input.initialOptionId);
  const selectedOption = input.actorSetOptions.find((option) => option.id === selectedOptionId);
  const selectedResourceId = resolveSelectedActorSetResourceId(input.policy);
  const resourcesQuery = useQuery({
    queryKey: ["trigger-actor-policy-resources", input.connectionId, selectedOption?.resourceKind],
    queryFn: ({ signal }) => {
      if (selectedOption === undefined) {
        throw new Error("Expected selected actor set option.");
      }

      return listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: selectedOption.resourceKind,
        signal,
      });
    },
    enabled: selectedOption?.summary?.syncState === "ready",
  });
  const resources = resourcesQuery.data?.items ?? [];

  return (
    <div className="space-y-2">
      <Select
        disabled={input.disabled || input.actorSetOptions.length === 0}
        onValueChange={(value) => {
          if (value === null) {
            return;
          }

          setSelectedOptionId(value);
          input.onActorSetOptionChanging();
          input.onPoliciesChange(
            removeActorPolicy({
              conditionId: input.conditionId,
              policies: input.policies,
            }),
          );
        }}
        value={selectedOptionId}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Group or set">
            {selectedOption?.label ?? selectedOptionId}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {input.actorSetOptions.map((option) => (
            <SelectItem
              disabled={option.summary?.syncState !== "ready"}
              key={option.id}
              value={option.id}
            >
              <span>{option.label}</span>
              <span className="text-muted-foreground block text-xs">
                {formatSyncStatus(option.summary)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedOption?.summary?.syncState !== "ready" ? (
        <Notice>{formatSyncStatus(selectedOption?.summary)}</Notice>
      ) : (
        <Select
          disabled={input.disabled || resourcesQuery.isPending || resourcesQuery.isError}
          onValueChange={(resourceId) => {
            if (selectedOption === undefined) {
              return;
            }

            const selectedResource = resources.find((resource) => resource.id === resourceId);
            if (selectedResource === undefined) {
              return;
            }

            input.onPoliciesChange(
              setActorPolicy({
                conditionId: input.conditionId,
                policies: input.policies,
                policy: createRelationshipActorPolicy({
                  option: selectedOption,
                  resource: selectedResource,
                }),
              }),
            );
            input.onActorSetSelected();
          }}
          value={selectedResourceId}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                resourcesQuery.isPending
                  ? "Loading groups..."
                  : resources.length === 0
                    ? "No synced groups"
                    : "Select group"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {resources.map((resource) => (
              <SelectItem key={resource.id} value={resource.id}>
                <span>{resource.displayName}</span>
                <span className="text-muted-foreground block text-xs">{resource.handle}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {resourcesQuery.isError ? <Notice variant="alert">Could not load groups.</Notice> : null}
    </div>
  );
}

export function WebhookTriggerActorPolicyFields(input: {
  connections: readonly IntegrationConnection[];
  disabled: boolean;
  eventActorPolicies: ActorPolicyMap | undefined;
  selectedEventIds: readonly string[];
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  onActorPoliciesChange: (policies: ActorPolicyMap) => void;
}): React.JSX.Element | null {
  const [specificActorPickerConditionIds, setSpecificActorPickerConditionIds] = useState<
    Record<string, true>
  >({});
  const [relationshipPickerConditionIds, setRelationshipPickerConditionIds] = useState<
    Record<string, true>
  >({});
  const rows = input.selectedEventIds.flatMap((conditionId) => {
    const eventOptionId = resolveWebhookTriggerEventOptionIdFromConditionId(conditionId);
    const eventOption = input.webhookEventOptions.find((option) => option.id === eventOptionId);
    if (eventOption?.actor === undefined) {
      return [];
    }

    return [{ conditionId, eventOption }];
  });

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 border-t p-4">
      {rows.map((row) => {
        const connection = input.connections.find(
          (candidate) => candidate.id === row.eventOption.connectionId,
        );
        const actorResourceKinds = resolveActorResourceKinds({
          connection,
          eventOption: row.eventOption,
        });
        const policy = input.eventActorPolicies?.[row.conditionId];
        const mode = resolveActorPolicyMode(policy);
        const specificActorPickerOpen = specificActorPickerConditionIds[row.conditionId] === true;
        const attributeOptions = resolveAttributeOptions({
          actorResourceKinds,
          resourceDefinitions: row.eventOption.resourceDefinitions,
        });
        const selectedAttributeOptionId = resolveSelectedAttributeOptionId({
          policy,
          options: attributeOptions,
        });
        const actorSetOptions = resolveActorSetOptions({
          actorResourceKinds,
          connection,
          eventOption: row.eventOption,
        });
        const selectedActorSetOptionId = resolveSelectedActorSetOptionId({
          policy,
          options: actorSetOptions,
        });
        const relationshipPickerOpen = relationshipPickerConditionIds[row.conditionId] === true;
        const hasReadyActorSetOptions = actorSetOptions.some(
          (option) => option.summary?.syncState === "ready",
        );
        const hasEligibleAttributeDefinitions = actorResourceKinds.some((actorResourceKind) => {
          const resourceDefinition = row.eventOption.resourceDefinitions?.find(
            (definition) => definition.kind === actorResourceKind.kind,
          );

          return (resourceDefinition?.attributeDefinitions ?? []).some(
            (attributeDefinition) => attributeDefinition.actorPolicyEligible === true,
          );
        });
        const attributeReadinessMessage =
          attributeOptions.length > 0
            ? null
            : hasEligibleAttributeDefinitions
              ? "Actor type policies need actor resource sync to be ready."
              : null;
        const label =
          rows.length === 1 ? "Allowed actors" : `Allowed actors for ${row.eventOption.label}`;

        return (
          <Field key={row.conditionId} orientation="horizontal">
            <FieldHeader>
              <FieldLabel>{label}</FieldLabel>
              <FieldDescription>{row.eventOption.connectionLabel}</FieldDescription>
            </FieldHeader>
            <FieldContent>
              <div className="space-y-2">
                <Select
                  disabled={input.disabled || mode === ActorPolicyModes.CUSTOM}
                  onValueChange={(value) => {
                    if (value === ActorPolicyModes.ANYONE) {
                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      input.onActorPoliciesChange(
                        removeActorPolicy({
                          conditionId: row.conditionId,
                          policies: input.eventActorPolicies,
                        }),
                      );
                      return;
                    }

                    if (value === ActorPolicyModes.ATTRIBUTE) {
                      const selectedOption = attributeOptions[0];
                      if (selectedOption === undefined) {
                        return;
                      }

                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      input.onActorPoliciesChange(
                        setActorPolicy({
                          conditionId: row.conditionId,
                          policies: input.eventActorPolicies,
                          policy: { anyOf: [selectedOption.rule] },
                        }),
                      );
                      return;
                    }

                    if (value === ActorPolicyModes.SPECIFIC) {
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        addSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      input.onActorPoliciesChange(
                        removeActorPolicy({
                          conditionId: row.conditionId,
                          policies: input.eventActorPolicies,
                        }),
                      );
                    }

                    if (value === ActorPolicyModes.RELATIONSHIP) {
                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        addSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                      input.onActorPoliciesChange(
                        removeActorPolicy({
                          conditionId: row.conditionId,
                          policies: input.eventActorPolicies,
                        }),
                      );
                    }
                  }}
                  value={mode}
                >
                  <SelectTrigger aria-label={label} className="w-full">
                    <SelectValue>{formatActorPolicyModeLabel(mode)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ActorPolicyModes.ANYONE}>Anyone</SelectItem>
                    <SelectItem
                      disabled={attributeOptions.length === 0}
                      value={ActorPolicyModes.ATTRIBUTE}
                    >
                      Actor type
                    </SelectItem>
                    <SelectItem
                      disabled={
                        !actorResourceKinds.some(
                          (resourceKind) => resourceKind.summary?.syncState === "ready",
                        )
                      }
                      value={ActorPolicyModes.SPECIFIC}
                    >
                      Specific actor
                    </SelectItem>
                    <SelectItem
                      disabled={!hasReadyActorSetOptions}
                      value={ActorPolicyModes.RELATIONSHIP}
                    >
                      Group or set
                    </SelectItem>
                  </SelectContent>
                </Select>

                {attributeReadinessMessage === null ? null : (
                  <Notice>{attributeReadinessMessage}</Notice>
                )}

                {mode === ActorPolicyModes.ATTRIBUTE ? (
                  <Select
                    disabled={input.disabled || attributeOptions.length === 0}
                    onValueChange={(value) => {
                      const selectedOption = attributeOptions.find((option) => option.id === value);
                      if (selectedOption === undefined) {
                        return;
                      }

                      input.onActorPoliciesChange(
                        setActorPolicy({
                          conditionId: row.conditionId,
                          policies: input.eventActorPolicies,
                          policy: { anyOf: [selectedOption.rule] },
                        }),
                      );
                    }}
                    value={selectedAttributeOptionId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select actor type" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributeOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          <span>{option.label}</span>
                          {option.description === undefined ? null : (
                            <span className="text-muted-foreground block text-xs">
                              {option.description}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {mode === ActorPolicyModes.SPECIFIC || specificActorPickerOpen ? (
                  <SpecificActorPolicyFields
                    actorResourceKinds={actorResourceKinds}
                    conditionId={row.conditionId}
                    connectionId={row.eventOption.connectionId}
                    disabled={input.disabled}
                    onPoliciesChange={input.onActorPoliciesChange}
                    policies={input.eventActorPolicies}
                    policy={policy}
                    initialResourceKind={resolveSelectedResourceKind({
                      policy,
                      actorResourceKinds,
                    })}
                    onResourceKindChanging={() => {
                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        addSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                    }}
                    onSpecificActorSelected={() => {
                      setSpecificActorPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                    }}
                  />
                ) : null}

                {mode === ActorPolicyModes.RELATIONSHIP || relationshipPickerOpen ? (
                  <RelationshipActorPolicyFields
                    actorSetOptions={actorSetOptions}
                    conditionId={row.conditionId}
                    connectionId={row.eventOption.connectionId}
                    disabled={input.disabled}
                    onPoliciesChange={input.onActorPoliciesChange}
                    policies={input.eventActorPolicies}
                    policy={policy}
                    initialOptionId={selectedActorSetOptionId}
                    onActorSetOptionChanging={() => {
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        addSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                    }}
                    onActorSetSelected={() => {
                      setRelationshipPickerConditionIds((currentOpenPickers) =>
                        removeSpecificActorPicker({
                          conditionId: row.conditionId,
                          openPickers: currentOpenPickers,
                        }),
                      );
                    }}
                  />
                ) : null}

                {actorSetOptions.length === 0 || hasReadyActorSetOptions ? null : (
                  <Notice>
                    Group actor policies need resource sync readiness before they can be selected.
                  </Notice>
                )}
              </div>
            </FieldContent>
          </Field>
        );
      })}
    </div>
  );
}
