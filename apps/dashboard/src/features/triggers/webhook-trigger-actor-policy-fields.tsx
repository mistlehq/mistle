import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldContent,
  FieldTitleWithTooltip,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  IntegrationConnectionResourcePickerView,
  type IntegrationConnectionResourcePickerItem,
} from "../forms/integration-connection-resource-picker-view.js";
import type { IntegrationResourceListViewState } from "../forms/integration-resource-picker-view-model.js";
import {
  listIntegrationConnectionResources,
  isIntegrationResourceSyncRequiredError,
  resolveIntegrationResourceSyncFailureReasonFromError,
  type IntegrationConnection,
  type IntegrationConnectionResource,
  type IntegrationResourceSyncFailureReason,
} from "../integrations/integrations-service.js";
import { FormPageSection } from "../shared/form-page.js";
import type {
  WebhookTriggerActorResourceDefinition,
  WebhookTriggerActorResourceRelationshipDefinition,
  WebhookTriggerEventOption,
} from "./webhook-trigger-event-types.js";
import { resolveWebhookTriggerEventOptionIdFromConditionId } from "./webhook-trigger-option-builders.js";
import type { WebhookTriggerActorPolicy } from "./webhook-triggers-types.js";

type ActorPolicyMap = Record<string, WebhookTriggerActorPolicy>;
type ActorPolicyRuleList = NonNullable<WebhookTriggerActorPolicy["anyOf"]>;
type ActorPolicyRule = ActorPolicyRuleList[number];
type ActorPolicyRuleListKey = "anyOf" | "noneOf";

type ActorPolicyResourceReference =
  | {
      resourceKind: string;
      resourceId: string;
    }
  | {
      resourceKind: string;
      externalId: string;
    }
  | {
      resourceKind: string;
      handle: string;
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

type ActorPolicyConditionGroup = {
  id: string;
  kind: "resource" | "relationship";
  ruleListKey: ActorPolicyRuleListKey;
  label: string;
  description: string;
  ruleIndexes: readonly number[];
  insertionIndex?: number;
  resourceKind?: string;
  relationshipKind?: string;
  scopeKind?: string;
};

type DraftActorPolicyRowPositions = Record<string, number>;

const ActorPolicyRowClassName =
  "grid w-full min-w-0 grid-cols-[7rem_auto_minmax(0,1fr)] items-start gap-3";
const ActorPolicyLabelClassName =
  "text-muted-foreground flex h-10 shrink-0 items-center text-sm whitespace-nowrap";
const ActorPolicyControlClassName = "min-w-0 flex-1";
const ActorPolicyOperatorClassName = "w-full self-start";

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

function formatActorPolicyResourceReference(input: {
  reference: ActorPolicyResourceReference;
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): string {
  const kindLabel = formatResourceKindLabel({
    resourceDefinitions: input.resourceDefinitions,
    kind: input.reference.resourceKind,
    plural: false,
  });

  if ("handle" in input.reference) {
    return `${kindLabel}: ${input.reference.handle}`;
  }

  if ("externalId" in input.reference) {
    return `${kindLabel}: ${input.reference.externalId}`;
  }

  return `${kindLabel}: ${input.reference.resourceId}`;
}

function formatActorPolicyRule(input: {
  rule: ActorPolicyRule;
  ruleListKey: ActorPolicyRuleListKey;
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): { label: string; description: string } {
  if (input.rule.kind === "resource") {
    return {
      label: input.ruleListKey === "anyOf" ? "Actor is one of" : "Actor is not one of",
      description: formatActorPolicyResourceReference({
        reference: input.rule.actor,
        resourceDefinitions: input.resourceDefinitions,
      }),
    };
  }

  if (input.rule.kind === "relationship") {
    return {
      label: input.ruleListKey === "anyOf" ? "Actor is in" : "Actor is not in",
      description: formatActorPolicyResourceReference({
        reference: input.rule.actorSet,
        resourceDefinitions: input.resourceDefinitions,
      }),
    };
  }

  throw new Error("Attribute actor policy rules are not exposed in the actor allowlist UI.");
}

function resolveSelectedActorSetOptionId(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  options: readonly ActorSetPolicyOption[];
}): string {
  const [rule] = input.policy?.[input.ruleListKey] ?? [];
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

function createActorPolicy(input: {
  anyOf: readonly ActorPolicyRule[];
  noneOf: readonly ActorPolicyRule[];
}): WebhookTriggerActorPolicy | undefined {
  const anyOf = createActorPolicyRuleList(input.anyOf);
  const noneOf = createActorPolicyRuleList(input.noneOf);
  if (anyOf === undefined && noneOf === undefined) {
    return undefined;
  }

  if (anyOf === undefined) {
    if (noneOf === undefined) {
      return undefined;
    }

    return { noneOf };
  }

  if (noneOf === undefined) {
    return { anyOf };
  }

  return { anyOf, noneOf };
}

function createActorPolicyRuleList(
  rules: readonly ActorPolicyRule[],
): ActorPolicyRuleList | undefined {
  const [firstRule, ...remainingRules] = rules;
  if (firstRule === undefined) {
    return undefined;
  }

  return [firstRule, ...remainingRules];
}

function removeActorPolicyRules(input: {
  conditionId: string;
  policies: ActorPolicyMap | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  ruleIndexes: readonly number[];
}): ActorPolicyMap {
  const currentPolicy = input.policies?.[input.conditionId];
  if (currentPolicy === undefined) {
    return input.policies ?? {};
  }

  const indexesToRemove = new Set(input.ruleIndexes);
  const nextPolicy = createActorPolicy({
    anyOf:
      input.ruleListKey === "anyOf"
        ? (currentPolicy.anyOf ?? []).filter((_rule, index) => !indexesToRemove.has(index))
        : (currentPolicy.anyOf ?? []),
    noneOf:
      input.ruleListKey === "noneOf"
        ? (currentPolicy.noneOf ?? []).filter((_rule, index) => !indexesToRemove.has(index))
        : (currentPolicy.noneOf ?? []),
  });
  if (nextPolicy === undefined) {
    return removeActorPolicy({
      conditionId: input.conditionId,
      policies: input.policies,
    });
  }

  return setActorPolicy({
    conditionId: input.conditionId,
    policies: input.policies,
    policy: nextPolicy,
  });
}

function moveActorPolicyRules(input: {
  conditionId: string;
  policies: ActorPolicyMap | undefined;
  fromRuleListKey: ActorPolicyRuleListKey;
  toRuleListKey: ActorPolicyRuleListKey;
  ruleIndexes: readonly number[];
}): ActorPolicyMap {
  if (input.fromRuleListKey === input.toRuleListKey) {
    return input.policies ?? {};
  }

  const currentPolicy = input.policies?.[input.conditionId];
  if (currentPolicy === undefined) {
    return input.policies ?? {};
  }

  const indexesToMove = new Set(input.ruleIndexes);
  const movedRules = (currentPolicy[input.fromRuleListKey] ?? []).filter((_rule, index) =>
    indexesToMove.has(index),
  );
  const nextFromRules = (currentPolicy[input.fromRuleListKey] ?? []).filter(
    (_rule, index) => !indexesToMove.has(index),
  );
  const nextToRules = [...(currentPolicy[input.toRuleListKey] ?? []), ...movedRules];
  const nextPolicy = createActorPolicy({
    anyOf:
      input.fromRuleListKey === "anyOf"
        ? nextFromRules
        : input.toRuleListKey === "anyOf"
          ? nextToRules
          : (currentPolicy.anyOf ?? []),
    noneOf:
      input.fromRuleListKey === "noneOf"
        ? nextFromRules
        : input.toRuleListKey === "noneOf"
          ? nextToRules
          : (currentPolicy.noneOf ?? []),
  });
  if (nextPolicy === undefined) {
    return removeActorPolicy({
      conditionId: input.conditionId,
      policies: input.policies,
    });
  }

  return setActorPolicy({
    conditionId: input.conditionId,
    policies: input.policies,
    policy: nextPolicy,
  });
}

function createActorPolicyConditionGroups(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): ActorPolicyConditionGroup[] {
  const groups: ActorPolicyConditionGroup[] = [];

  const ruleListKeys: readonly ActorPolicyRuleListKey[] = ["anyOf", "noneOf"];
  for (const ruleListKey of ruleListKeys) {
    input.policy?.[ruleListKey]?.forEach((rule, ruleIndex) => {
      const formattedRule = formatActorPolicyRule({
        rule,
        ruleListKey,
        resourceDefinitions: input.resourceDefinitions,
      });
      const groupId = resolveActorPolicyConditionGroupId({ rule, ruleListKey });
      const existingGroupIndex = groups.findIndex((group) => group.id === groupId);

      if (existingGroupIndex === -1) {
        groups.push({
          id: groupId,
          kind: rule.kind,
          ruleListKey,
          label: formattedRule.label,
          description: formattedRule.description,
          ruleIndexes: [ruleIndex],
          ...(rule.kind === "relationship"
            ? {
                resourceKind: rule.actorSet.resourceKind,
                relationshipKind: rule.relationshipKind,
                scopeKind: rule.scope.resourceKind,
              }
            : {}),
        });
        return;
      }

      const existingGroup = groups[existingGroupIndex];
      if (existingGroup === undefined) {
        throw new Error("Expected actor policy condition group.");
      }

      groups[existingGroupIndex] = {
        ...existingGroup,
        description: `${existingGroup.description}, ${formattedRule.description}`,
        ruleIndexes: [...existingGroup.ruleIndexes, ruleIndex],
      };
    });
  }

  return groups;
}

function resolveActorPolicyConditionGroupId(input: {
  rule: ActorPolicyRule;
  ruleListKey: ActorPolicyRuleListKey;
}): string {
  if (input.rule.kind === "resource") {
    return `${input.ruleListKey}:resource`;
  }

  if (input.rule.kind === "relationship") {
    return `${input.ruleListKey}:${resolveRelationshipActorPolicyConditionGroupId({
      relationshipKind: input.rule.relationshipKind,
      resourceKind: input.rule.actorSet.resourceKind,
      scopeKind: input.rule.scope.resourceKind,
    })}`;
  }

  throw new Error("Attribute actor policy rules are not exposed in the actor allowlist UI.");
}

function resolveRelationshipActorPolicyConditionGroupId(input: {
  relationshipKind: string;
  resourceKind: string;
  scopeKind: string;
}): string {
  return ["relationship", input.relationshipKind, input.resourceKind, input.scopeKind].join(":");
}

function resolveRelationshipActorPolicyOptionId(input: {
  relationshipKind: string;
  resourceKind: string;
  scopeKind: string;
}): string {
  return `${input.relationshipKind}:${input.resourceKind}:${input.scopeKind}`;
}

function addSpecificActorPicker(input: {
  conditionId: string;
  openPickers: Record<string, ActorPolicyRuleListKey>;
  ruleListKey: ActorPolicyRuleListKey;
}): Record<string, ActorPolicyRuleListKey> {
  return {
    ...input.openPickers,
    [input.conditionId]: input.ruleListKey,
  };
}

function removeSpecificActorPicker(input: {
  conditionId: string;
  openPickers: Record<string, ActorPolicyRuleListKey>;
}): Record<string, ActorPolicyRuleListKey> {
  return Object.fromEntries(
    Object.entries(input.openPickers).filter(([conditionId]) => conditionId !== input.conditionId),
  );
}

function addRelationshipPicker(input: {
  conditionId: string;
  openPickers: Record<string, string>;
  optionId: string;
}): Record<string, string> {
  return {
    ...input.openPickers,
    [input.conditionId]: input.optionId,
  };
}

function removeRelationshipPicker(input: {
  conditionId: string;
  openPickers: Record<string, string>;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input.openPickers).filter(([conditionId]) => conditionId !== input.conditionId),
  );
}

function setDraftActorPolicyRowPosition(input: {
  conditionId: string;
  positions: DraftActorPolicyRowPositions;
  position: number;
}): DraftActorPolicyRowPositions {
  return {
    ...input.positions,
    [input.conditionId]: input.position,
  };
}

function removeDraftActorPolicyRowPosition(input: {
  conditionId: string;
  positions: DraftActorPolicyRowPositions;
}): DraftActorPolicyRowPositions {
  return Object.fromEntries(
    Object.entries(input.positions).filter(([conditionId]) => conditionId !== input.conditionId),
  );
}

function insertDraftActorPolicyConditionGroup(input: {
  conditionGroups: readonly ActorPolicyConditionGroup[];
  draftGroup: ActorPolicyConditionGroup | null;
  position: number | undefined;
}): ActorPolicyConditionGroup[] {
  if (input.draftGroup === null) {
    return [...input.conditionGroups];
  }

  if (input.position === undefined) {
    return [...input.conditionGroups, input.draftGroup];
  }

  const insertionIndex = Math.min(Math.max(input.position, 0), input.conditionGroups.length);

  return [
    ...input.conditionGroups.slice(0, insertionIndex),
    input.draftGroup,
    ...input.conditionGroups.slice(insertionIndex),
  ];
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
          id: resolveRelationshipActorPolicyOptionId({
            relationshipKind: definition.relationshipKind,
            resourceKind: definition.objectResourceKind,
            scopeKind: scopeDefinition.scopeKind,
          }),
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
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  insertionIndex: number | undefined;
  onPoliciesChange: (policies: ActorPolicyMap) => void;
  onSelectionCleared: () => void;
}): React.JSX.Element {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const readyActorResourceKinds = input.actorResourceKinds.filter(
    (resourceKind) => resourceKind.summary?.syncState === "ready",
  );
  const actorKindSet = new Set(input.actorResourceKinds.map((resourceKind) => resourceKind.kind));
  const resourceQueries = useQueries({
    queries: readyActorResourceKinds.map((resourceKind) => ({
      queryKey: ["trigger-actor-policy-resources", input.connectionId, resourceKind.kind],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listIntegrationConnectionResources({
          connectionId: input.connectionId,
          kind: resourceKind.kind,
          signal,
        }),
    })),
  });
  const resourcesByKind = readyActorResourceKinds.flatMap((resourceKind, index) => {
    const query = resourceQueries[index];
    return (query?.data?.items ?? []).map((resource) => ({ resourceKind, resource }));
  });
  const resourcesByValue = new Map(
    resourcesByKind.map(({ resource, resourceKind }) => [
      encodeActorResourcePickerValue({
        resourceKind: resourceKind.kind,
        resourceId: resource.id,
      }),
      resource,
    ]),
  );
  const selectedResourceValues = resolveSelectedResourceValues({
    actorKindSet,
    policy: input.policy,
    ruleListKey: input.ruleListKey,
  });
  const resourceItems = toActorResourcePickerItems({
    resourceDefinitions: input.resourceDefinitions,
    resourcesByKind,
    search,
    selectedReferences: (input.policy?.[input.ruleListKey] ?? []).flatMap((rule) =>
      rule.kind === "resource" && actorKindSet.has(rule.actor.resourceKind) ? [rule.actor] : [],
    ),
  });
  const isPending = resourceQueries.some((query) => query.isPending);
  const isFetching = resourceQueries.some((query) => query.isFetching);
  const isError = resourceQueries.some((query) => query.isError);

  return (
    <div className="min-w-0 space-y-2">
      {readyActorResourceKinds.length === 0 ? (
        <Notice>Actor resources need to be synced before they can be selected.</Notice>
      ) : (
        <IntegrationConnectionResourcePickerView
          density="compact"
          disabled={input.disabled || isPending}
          emptyMessage="No synced actors."
          id={inputId}
          isRefreshing={isFetching}
          label="actor"
          listState={resolveResourceListViewState({
            errors: resourceQueries.filter((query) => query.isError).map((query) => query.error),
            errorMessage: "Could not load actors.",
            isError,
            isPending,
          })}
          onBlur={() => {}}
          onFocus={() => {}}
          onRefresh={() => {
            for (const query of resourceQueries) {
              void query.refetch();
            }
          }}
          onSearchChange={setSearch}
          onSelectionChange={(resourceValues) => {
            if (resourceValues.length === 0) {
              input.onSelectionCleared();
            }

            input.onPoliciesChange(
              updateActorPolicyRules({
                conditionId: input.conditionId,
                insertionIndex: input.insertionIndex,
                nextRules: resourceValues.map((resourceValue) =>
                  createResourceActorPolicyRule({
                    currentPolicy: input.policy,
                    ruleListKey: input.ruleListKey,
                    resourceValue,
                  }),
                ),
                policies: input.policies,
                ruleListKey: input.ruleListKey,
                shouldReplaceRule: (rule) =>
                  rule.kind === "resource" && actorKindSet.has(rule.actor.resourceKind),
              }),
            );
          }}
          refreshErrorMessage={null}
          refreshLabel="Refresh actors"
          refreshTooltip="Refresh actors"
          resourceLabelPlural="actors"
          search={search}
          searchPlaceholder={
            isPending
              ? "Loading actors..."
              : resourcesByKind.length === 0
                ? "No synced actors"
                : "Search actors"
          }
          selectedValues={selectedResourceValues}
          unavailableSelectedValues={selectedResourceValues.filter(
            (resourceValue) => !resourcesByValue.has(resourceValue),
          )}
          visibleItems={resourceItems}
        />
      )}
    </div>
  );
}

function resolveSelectedResourceValues(input: {
  actorKindSet: ReadonlySet<string>;
  policy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
}): string[] {
  return (input.policy?.[input.ruleListKey] ?? []).flatMap((rule) => {
    if (rule.kind !== "resource" || !input.actorKindSet.has(rule.actor.resourceKind)) {
      return [];
    }

    return [encodeActorResourcePickerValue(rule.actor)];
  });
}

function resolveSelectedActorSetResourceValues(input: {
  option: ActorSetPolicyOption | undefined;
  policy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
}): string[] {
  if (input.option === undefined) {
    return [];
  }

  return (input.policy?.[input.ruleListKey] ?? []).flatMap((rule) => {
    if (
      rule.kind !== "relationship" ||
      rule.relationshipKind !== input.option?.relationshipDefinition.relationshipKind ||
      rule.actorSet.resourceKind !== input.option.resourceKind ||
      rule.scope.resourceKind !== input.option.scopeKind ||
      !("resourceId" in rule.actorSet)
    ) {
      return [];
    }

    return [encodeActorPolicyResourceReference(rule.actorSet)];
  });
}

export function resolveResourceListViewState(input: {
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  errors: readonly unknown[];
}): IntegrationResourceListViewState {
  if (input.isPending) {
    return { mode: "loading" };
  }

  if (input.isError) {
    if (isResourceSyncRequiredOnlyError(input.errors)) {
      return { mode: "ready" };
    }

    const reason = resolveResourceListFailureReason(input.errors);
    return {
      mode: "error",
      ...(reason === null ? {} : { reason }),
      message: input.errorMessage,
    };
  }

  return { mode: "ready" };
}

function isResourceSyncRequiredOnlyError(errors: readonly unknown[]): boolean {
  return errors.length > 0 && errors.every(isIntegrationResourceSyncRequiredError);
}

function resolveResourceListFailureReason(
  errors: readonly unknown[],
): IntegrationResourceSyncFailureReason | null {
  const reasons = errors.flatMap((error) => {
    if (isIntegrationResourceSyncRequiredError(error)) {
      return [];
    }

    return [resolveIntegrationResourceSyncFailureReasonFromError(error) ?? "sync-failed"];
  });

  if (reasons.length === 0) {
    return null;
  }

  if (reasons.includes("sync-failed")) {
    return "sync-failed";
  }

  if (reasons.includes("credential-failed")) {
    return "credential-failed";
  }

  return "permission-denied";
}

function toResourcePickerItems(input: {
  resources: readonly IntegrationConnectionResource[];
  search: string;
  selectedReferences: readonly ActorPolicyResourceReference[];
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): IntegrationConnectionResourcePickerItem[] {
  const normalizedSearch = input.search.trim().toLowerCase();
  const resourceItems = input.resources.map((resource) => ({
    id: resource.id,
    value: resource.id,
    label: resource.displayName,
  }));
  const resourceValueSet = new Set(resourceItems.map((item) => item.value));
  const selectedReferenceItems = input.selectedReferences.flatMap((reference) => {
    const value = encodeActorPolicyResourceReference(reference);
    if (resourceValueSet.has(value)) {
      return [];
    }

    return [
      {
        id: value,
        value,
        label: formatActorPolicyResourceReference({
          reference,
          resourceDefinitions: input.resourceDefinitions,
        }),
      },
    ];
  });

  return [...resourceItems, ...selectedReferenceItems].filter((item) => {
    if (normalizedSearch.length === 0) {
      return true;
    }

    return (
      item.label.toLowerCase().includes(normalizedSearch) ||
      item.value.toLowerCase().includes(normalizedSearch)
    );
  });
}

function toActorResourcePickerItems(input: {
  resourcesByKind: readonly {
    resourceKind: ActorPolicyResourceKind;
    resource: IntegrationConnectionResource;
  }[];
  search: string;
  selectedReferences: readonly ActorPolicyResourceReference[];
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
}): IntegrationConnectionResourcePickerItem[] {
  const normalizedSearch = input.search.trim().toLowerCase();
  const resourceItems = input.resourcesByKind.map(({ resource, resourceKind }) => ({
    id: encodeActorResourcePickerValue({
      resourceKind: resourceKind.kind,
      resourceId: resource.id,
    }),
    value: encodeActorResourcePickerValue({
      resourceKind: resourceKind.kind,
      resourceId: resource.id,
    }),
    label: `${resource.displayName} (${resourceKind.label})`,
  }));
  const resourceValueSet = new Set(resourceItems.map((item) => item.value));
  const selectedReferenceItems = input.selectedReferences.flatMap((reference) => {
    const value = encodeActorResourcePickerValue(reference);
    if (resourceValueSet.has(value)) {
      return [];
    }

    return [
      {
        id: value,
        value,
        label: formatActorPolicyResourceReference({
          reference,
          resourceDefinitions: input.resourceDefinitions,
        }),
      },
    ];
  });

  return [...resourceItems, ...selectedReferenceItems].filter((item) => {
    if (normalizedSearch.length === 0) {
      return true;
    }

    return (
      item.label.toLowerCase().includes(normalizedSearch) ||
      item.value.toLowerCase().includes(normalizedSearch)
    );
  });
}

function encodeActorPolicyResourceReference(reference: ActorPolicyResourceReference): string {
  if ("resourceId" in reference) {
    return reference.resourceId;
  }

  if ("handle" in reference) {
    return `handle:${reference.resourceKind}:${reference.handle}`;
  }

  return `external:${reference.resourceKind}:${reference.externalId}`;
}

function encodeActorResourcePickerValue(reference: ActorPolicyResourceReference): string {
  if ("resourceId" in reference) {
    return `resource:${reference.resourceKind}:${reference.resourceId}`;
  }

  return encodeActorPolicyResourceReference(reference);
}

function decodeActorResourcePickerValue(value: string): ActorPolicyResourceReference {
  const [referenceType, resourceKind, ...referenceValueParts] = value.split(":");
  const referenceValue = referenceValueParts.join(":");
  if (resourceKind === undefined || referenceValue.length === 0) {
    throw new Error("Expected actor resource picker value to include resource kind and value.");
  }

  if (referenceType === "resource") {
    return {
      resourceKind,
      resourceId: referenceValue,
    };
  }

  if (referenceType === "handle") {
    return {
      resourceKind,
      handle: referenceValue,
    };
  }

  if (referenceType === "external") {
    return {
      resourceKind,
      externalId: referenceValue,
    };
  }

  throw new Error("Expected actor resource picker value to include a supported reference type.");
}

function createResourceActorPolicyRule(input: {
  currentPolicy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  resourceValue: string;
}): ActorPolicyRule {
  const actor = decodeActorResourcePickerValue(input.resourceValue);
  const existingRule = input.currentPolicy?.[input.ruleListKey]?.find(
    (rule) =>
      rule.kind === "resource" &&
      rule.actor.resourceKind === actor.resourceKind &&
      encodeActorResourcePickerValue(rule.actor) === input.resourceValue,
  );
  if (existingRule !== undefined) {
    return existingRule;
  }

  return {
    kind: "resource",
    actor,
  };
}

function createRelationshipActorPolicyRule(input: {
  currentPolicy: WebhookTriggerActorPolicy | undefined;
  option: ActorSetPolicyOption;
  ruleListKey: ActorPolicyRuleListKey;
  resourceValue: string;
}): ActorPolicyRule {
  const existingRule = input.currentPolicy?.[input.ruleListKey]?.find(
    (rule) =>
      rule.kind === "relationship" &&
      rule.relationshipKind === input.option.relationshipDefinition.relationshipKind &&
      rule.actorSet.resourceKind === input.option.resourceKind &&
      rule.scope.resourceKind === input.option.scopeKind &&
      encodeActorPolicyResourceReference(rule.actorSet) === input.resourceValue,
  );
  if (existingRule !== undefined) {
    return existingRule;
  }

  return {
    kind: "relationship",
    relationshipKind: input.option.relationshipDefinition.relationshipKind,
    actorSet: {
      resourceKind: input.option.resourceKind,
      resourceId: input.resourceValue,
    },
    scope: {
      resourceKind: input.option.scopeKind,
      resourceId: input.resourceValue,
    },
  };
}

function updateActorPolicyRules(input: {
  conditionId: string;
  insertionIndex: number | undefined;
  policies: ActorPolicyMap | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  shouldReplaceRule: (rule: ActorPolicyRule) => boolean;
  nextRules: readonly ActorPolicyRule[];
}): ActorPolicyMap {
  const currentPolicy = input.policies?.[input.conditionId];
  const currentRules = currentPolicy?.[input.ruleListKey] ?? [];
  const nextPolicyRules: ActorPolicyRule[] = [];
  let replacementInserted = false;

  for (const rule of currentRules) {
    if (!input.shouldReplaceRule(rule)) {
      nextPolicyRules.push(rule);
      continue;
    }

    if (!replacementInserted) {
      nextPolicyRules.push(...input.nextRules);
      replacementInserted = true;
    }
  }

  if (!replacementInserted && input.insertionIndex !== undefined) {
    const insertionIndex = Math.min(Math.max(input.insertionIndex, 0), nextPolicyRules.length);
    nextPolicyRules.splice(insertionIndex, 0, ...input.nextRules);
  }

  if (!replacementInserted && input.insertionIndex === undefined) {
    nextPolicyRules.push(...input.nextRules);
  }

  if (nextPolicyRules.length === 0) {
    const nextPolicy = createActorPolicy({
      anyOf: input.ruleListKey === "anyOf" ? [] : (currentPolicy?.anyOf ?? []),
      noneOf: input.ruleListKey === "noneOf" ? [] : (currentPolicy?.noneOf ?? []),
    });
    if (nextPolicy === undefined) {
      return removeActorPolicy({
        conditionId: input.conditionId,
        policies: input.policies,
      });
    }

    return setActorPolicy({
      conditionId: input.conditionId,
      policies: input.policies,
      policy: nextPolicy,
    });
  }

  const nextPolicy = createActorPolicy({
    anyOf: input.ruleListKey === "anyOf" ? nextPolicyRules : (currentPolicy?.anyOf ?? []),
    noneOf: input.ruleListKey === "noneOf" ? nextPolicyRules : (currentPolicy?.noneOf ?? []),
  });
  if (nextPolicy === undefined) {
    return removeActorPolicy({
      conditionId: input.conditionId,
      policies: input.policies,
    });
  }

  return setActorPolicy({
    conditionId: input.conditionId,
    policies: input.policies,
    policy: nextPolicy,
  });
}

function RelationshipActorPolicyFields(input: {
  actorSetOptions: readonly ActorSetPolicyOption[];
  conditionId: string;
  connectionId: string;
  disabled: boolean;
  policies: ActorPolicyMap | undefined;
  policy: WebhookTriggerActorPolicy | undefined;
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
  ruleListKey: ActorPolicyRuleListKey;
  initialOptionId: string;
  insertionIndex: number | undefined;
  onPoliciesChange: (policies: ActorPolicyMap) => void;
  onSelectionCleared: (optionId: string) => void;
  onActorSetOptionChanging: (optionId: string) => void;
}): React.JSX.Element {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState(input.initialOptionId);
  const selectedOption = input.actorSetOptions.find((option) => option.id === selectedOptionId);
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
  const selectedResourceValues = resolveSelectedActorSetResourceValues({
    option: selectedOption,
    policy: input.policy,
    ruleListKey: input.ruleListKey,
  });
  const resourceItems = toResourcePickerItems({
    resourceDefinitions: input.resourceDefinitions,
    resources,
    search,
    selectedReferences: (input.policy?.[input.ruleListKey] ?? []).flatMap((rule) =>
      rule.kind === "relationship" &&
      selectedOption !== undefined &&
      rule.relationshipKind === selectedOption.relationshipDefinition.relationshipKind &&
      rule.actorSet.resourceKind === selectedOption.resourceKind &&
      rule.scope.resourceKind === selectedOption.scopeKind
        ? [rule.actorSet]
        : [],
    ),
  });

  return (
    <div className="min-w-0 space-y-2">
      <Select
        disabled={input.disabled || input.actorSetOptions.length === 0}
        onValueChange={(value) => {
          if (value === null) {
            return;
          }

          setSelectedOptionId(value);
          input.onActorSetOptionChanging(value);
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
              <span className="flex min-w-0 items-center gap-2">
                <span>{option.label}</span>
                <span className="text-muted-foreground text-xs">
                  {formatSyncStatus(option.summary)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedOption?.summary?.syncState !== "ready" ? (
        <Notice>{formatSyncStatus(selectedOption?.summary)}</Notice>
      ) : (
        <IntegrationConnectionResourcePickerView
          density="compact"
          disabled={input.disabled || resourcesQuery.isPending || selectedOption === undefined}
          emptyMessage={`No synced ${selectedOption?.label.toLowerCase() ?? "groups"}.`}
          id={inputId}
          isRefreshing={resourcesQuery.isFetching}
          label="group or set"
          listState={resolveResourceListViewState({
            errors: resourcesQuery.isError ? [resourcesQuery.error] : [],
            errorMessage: "Could not load groups.",
            isError: resourcesQuery.isError,
            isPending: resourcesQuery.isPending,
          })}
          onBlur={() => {}}
          onFocus={() => {}}
          onRefresh={() => {
            void resourcesQuery.refetch();
          }}
          onSearchChange={setSearch}
          onSelectionChange={(resourceValues) => {
            if (selectedOption === undefined) {
              return;
            }
            if (resourceValues.length === 0) {
              input.onSelectionCleared(selectedOption.id);
            }

            input.onPoliciesChange(
              updateActorPolicyRules({
                conditionId: input.conditionId,
                insertionIndex: input.insertionIndex,
                nextRules: resourceValues.map((resourceValue) =>
                  createRelationshipActorPolicyRule({
                    currentPolicy: input.policy,
                    option: selectedOption,
                    ruleListKey: input.ruleListKey,
                    resourceValue,
                  }),
                ),
                policies: input.policies,
                ruleListKey: input.ruleListKey,
                shouldReplaceRule: (rule) =>
                  rule.kind === "relationship" &&
                  rule.relationshipKind ===
                    selectedOption.relationshipDefinition.relationshipKind &&
                  rule.actorSet.resourceKind === selectedOption.resourceKind &&
                  rule.scope.resourceKind === selectedOption.scopeKind,
              }),
            );
          }}
          refreshErrorMessage={null}
          refreshLabel="Refresh groups"
          refreshTooltip="Refresh groups"
          resourceLabelPlural={selectedOption?.label ?? "groups"}
          search={search}
          searchPlaceholder={
            resourcesQuery.isPending
              ? "Loading groups..."
              : resources.length === 0
                ? "No synced groups"
                : "Search groups"
          }
          selectedValues={selectedResourceValues}
          unavailableSelectedValues={selectedResourceValues.filter(
            (resourceValue) => !resources.some((resource) => resource.id === resourceValue),
          )}
          visibleItems={resourceItems}
        />
      )}
    </div>
  );
}

function AddActorPolicyConditionButton(input: {
  conditionId: string;
  connections: readonly IntegrationConnection[];
  disabled: boolean;
  eventActorPolicies: ActorPolicyMap | undefined;
  eventOption: WebhookTriggerEventOption;
  onActorPoliciesChange: (policies: ActorPolicyMap) => void;
  onOpenRelationshipPicker: (optionId: string, ruleListKey: ActorPolicyRuleListKey) => void;
  onOpenSpecificActorPicker: (ruleListKey: ActorPolicyRuleListKey) => void;
}): React.JSX.Element {
  const connection = input.connections.find(
    (candidate) => candidate.id === input.eventOption.connectionId,
  );
  const actorResourceKinds = resolveActorResourceKinds({
    connection,
    eventOption: input.eventOption,
  });
  const actorSetOptions = resolveActorSetOptions({
    actorResourceKinds,
    connection,
    eventOption: input.eventOption,
  });
  const currentPolicy = input.eventActorPolicies?.[input.conditionId];
  const hasAnyOfResourceActorPolicy = hasResourceActorPolicy({
    policy: currentPolicy,
    ruleListKey: "anyOf",
  });
  const hasNoneOfResourceActorPolicy = hasResourceActorPolicy({
    policy: currentPolicy,
    ruleListKey: "noneOf",
  });
  const usedAnyOfActorSetOptionIds = resolveUsedActorSetOptionIds({
    policy: currentPolicy,
    ruleListKey: "anyOf",
  });
  const usedNoneOfActorSetOptionIds = resolveUsedActorSetOptionIds({
    policy: currentPolicy,
    ruleListKey: "noneOf",
  });
  const readyAnyOfActorSetOptions = actorSetOptions.filter(
    (option) => option.summary?.syncState === "ready" && !usedAnyOfActorSetOptionIds.has(option.id),
  );
  const readyNoneOfActorSetOptions = actorSetOptions.filter(
    (option) =>
      option.summary?.syncState === "ready" && !usedNoneOfActorSetOptionIds.has(option.id),
  );
  const hasReadyActorResourceKinds = actorResourceKinds.some(
    (resourceKind) => resourceKind.summary?.syncState === "ready",
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button disabled={input.disabled} type="button" variant="outline" />}
      >
        <PlusIcon aria-hidden className="size-4" />
        Add actor condition
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!hasReadyActorResourceKinds || hasAnyOfResourceActorPolicy}
          onClick={() => {
            if (!hasReadyActorResourceKinds || hasAnyOfResourceActorPolicy) {
              return;
            }

            input.onOpenSpecificActorPicker("anyOf");
          }}
        >
          <span>Actor is one of</span>
          {actorResourceKinds.length === 0 ? (
            <span className="text-muted-foreground block text-xs">
              No actor resources for this event.
            </span>
          ) : !hasReadyActorResourceKinds ? (
            <span className="text-muted-foreground block text-xs">
              Actor resources are not synced yet.
            </span>
          ) : hasAnyOfResourceActorPolicy ? (
            <span className="text-muted-foreground block text-xs">
              Use the existing actor row to add more actors.
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReadyActorResourceKinds || hasNoneOfResourceActorPolicy}
          onClick={() => {
            if (!hasReadyActorResourceKinds || hasNoneOfResourceActorPolicy) {
              return;
            }

            input.onOpenSpecificActorPicker("noneOf");
          }}
        >
          <span>Actor is not one of</span>
          {actorResourceKinds.length === 0 ? (
            <span className="text-muted-foreground block text-xs">
              No actor resources for this event.
            </span>
          ) : !hasReadyActorResourceKinds ? (
            <span className="text-muted-foreground block text-xs">
              Actor resources are not synced yet.
            </span>
          ) : hasNoneOfResourceActorPolicy ? (
            <span className="text-muted-foreground block text-xs">
              Use the existing excluded actor row to add more actors.
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={actorSetOptions.length === 0 || readyAnyOfActorSetOptions.length === 0}
          onClick={() => {
            const selectedOption = readyAnyOfActorSetOptions[0];
            if (selectedOption === undefined) {
              return;
            }

            input.onOpenRelationshipPicker(selectedOption.id, "anyOf");
          }}
        >
          <span>Actor is in group or set</span>
          {actorSetOptions.length === 0 ? (
            <span className="text-muted-foreground block text-xs">
              No group actor sets for this event.
            </span>
          ) : readyAnyOfActorSetOptions.length > 0 ? null : (
            <span className="text-muted-foreground block text-xs">
              All available group actor sets are already added or not synced yet.
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={actorSetOptions.length === 0 || readyNoneOfActorSetOptions.length === 0}
          onClick={() => {
            const selectedOption = readyNoneOfActorSetOptions[0];
            if (selectedOption === undefined) {
              return;
            }

            input.onOpenRelationshipPicker(selectedOption.id, "noneOf");
          }}
        >
          <span>Actor is not in group or set</span>
          {actorSetOptions.length === 0 ? (
            <span className="text-muted-foreground block text-xs">
              No group actor sets for this event.
            </span>
          ) : readyNoneOfActorSetOptions.length > 0 ? null : (
            <span className="text-muted-foreground block text-xs">
              All available group actor sets are already added or not synced yet.
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hasResourceActorPolicy(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
}): boolean {
  return (input.policy?.[input.ruleListKey] ?? []).some((rule) => rule.kind === "resource");
}

function resolveUsedActorSetOptionIds(input: {
  policy: WebhookTriggerActorPolicy | undefined;
  ruleListKey: ActorPolicyRuleListKey;
}): Set<string> {
  return new Set(
    (input.policy?.[input.ruleListKey] ?? []).flatMap((rule) =>
      rule.kind === "relationship"
        ? [
            resolveRelationshipActorPolicyOptionId({
              relationshipKind: rule.relationshipKind,
              resourceKind: rule.actorSet.resourceKind,
              scopeKind: rule.scope.resourceKind,
            }),
          ]
        : [],
    ),
  );
}

function SpecificActorOperatorSelect(input: {
  disabled: boolean;
  ruleListKey: ActorPolicyRuleListKey;
  onRuleListKeyChange: (ruleListKey: ActorPolicyRuleListKey) => void;
}): React.JSX.Element {
  return (
    <Select
      disabled={input.disabled}
      onValueChange={(value) => {
        if (value === "anyOf" || value === "noneOf") {
          input.onRuleListKeyChange(value);
        }
      }}
      value={input.ruleListKey}
    >
      <SelectTrigger aria-label="Actor condition operator" className={ActorPolicyOperatorClassName}>
        <SelectValue>{input.ruleListKey === "anyOf" ? "Is" : "Is not"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="anyOf">Is</SelectItem>
        <SelectItem value="noneOf">Is not</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RelationshipActorOperatorSelect(input: {
  disabled: boolean;
  ruleListKey: ActorPolicyRuleListKey;
  onRuleListKeyChange: (ruleListKey: ActorPolicyRuleListKey) => void;
}): React.JSX.Element {
  return (
    <Select
      disabled={input.disabled}
      onValueChange={(value) => {
        if (value === "anyOf" || value === "noneOf") {
          input.onRuleListKeyChange(value);
        }
      }}
      value={input.ruleListKey}
    >
      <SelectTrigger aria-label="Actor condition operator" className={ActorPolicyOperatorClassName}>
        <SelectValue>{input.ruleListKey === "anyOf" ? "Is in" : "Is not in"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="anyOf">Is in</SelectItem>
        <SelectItem value="noneOf">Is not in</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ActorPolicyConditionGroupFields(input: {
  actorResourceKinds: readonly ActorPolicyResourceKind[];
  actorSetOptions: readonly ActorSetPolicyOption[];
  conditionGroup: ActorPolicyConditionGroup;
  conditionId: string;
  connectionId: string;
  disabled: boolean;
  resourceDefinitions: readonly WebhookTriggerActorResourceDefinition[] | undefined;
  policies: ActorPolicyMap | undefined;
  policy: WebhookTriggerActorPolicy | undefined;
  onPoliciesChange: (policies: ActorPolicyMap) => void;
  onResourceSelectionCleared: (conditionGroup: ActorPolicyConditionGroup) => void;
  onActorSetOptionChanging: (optionId: string) => void;
  onRuleListKeyChanging: (
    ruleListKey: ActorPolicyRuleListKey,
    conditionGroup: ActorPolicyConditionGroup,
  ) => void;
  onActorSetSelectionCleared: (optionId: string, conditionGroup: ActorPolicyConditionGroup) => void;
}): React.JSX.Element {
  if (input.conditionGroup.kind === "resource") {
    return (
      <div className={ActorPolicyRowClassName}>
        <SpecificActorOperatorSelect
          disabled={input.disabled}
          onRuleListKeyChange={(ruleListKey) => {
            input.onRuleListKeyChanging(ruleListKey, input.conditionGroup);
            if (input.conditionGroup.ruleIndexes.length === 0) {
              return;
            }

            input.onPoliciesChange(
              moveActorPolicyRules({
                conditionId: input.conditionId,
                fromRuleListKey: input.conditionGroup.ruleListKey,
                policies: input.policies,
                ruleIndexes: input.conditionGroup.ruleIndexes,
                toRuleListKey: ruleListKey,
              }),
            );
          }}
          ruleListKey={input.conditionGroup.ruleListKey}
        />
        <span className={ActorPolicyLabelClassName}>one of</span>
        <div className={ActorPolicyControlClassName}>
          <SpecificActorPolicyFields
            actorResourceKinds={input.actorResourceKinds}
            conditionId={input.conditionId}
            connectionId={input.connectionId}
            disabled={input.disabled}
            insertionIndex={
              input.conditionGroup.ruleIndexes[0] ?? input.conditionGroup.insertionIndex
            }
            onPoliciesChange={input.onPoliciesChange}
            onSelectionCleared={() => {
              input.onResourceSelectionCleared(input.conditionGroup);
            }}
            policies={input.policies}
            policy={input.policy}
            resourceDefinitions={input.resourceDefinitions}
            ruleListKey={input.conditionGroup.ruleListKey}
          />
        </div>
      </div>
    );
  }

  if (input.conditionGroup.kind === "relationship") {
    const initialOptionId =
      input.actorSetOptions.find(
        (option) =>
          option.relationshipDefinition.relationshipKind ===
            input.conditionGroup.relationshipKind &&
          option.resourceKind === input.conditionGroup.resourceKind &&
          option.scopeKind === input.conditionGroup.scopeKind,
      )?.id ??
      resolveSelectedActorSetOptionId({
        policy: input.policy,
        ruleListKey: input.conditionGroup.ruleListKey,
        options: input.actorSetOptions,
      });

    return (
      <div className="grid w-full min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <RelationshipActorOperatorSelect
          disabled={input.disabled}
          onRuleListKeyChange={(ruleListKey) => {
            input.onRuleListKeyChanging(ruleListKey, input.conditionGroup);
            if (input.conditionGroup.ruleIndexes.length === 0) {
              return;
            }

            input.onPoliciesChange(
              moveActorPolicyRules({
                conditionId: input.conditionId,
                fromRuleListKey: input.conditionGroup.ruleListKey,
                policies: input.policies,
                ruleIndexes: input.conditionGroup.ruleIndexes,
                toRuleListKey: ruleListKey,
              }),
            );
          }}
          ruleListKey={input.conditionGroup.ruleListKey}
        />
        <div className={ActorPolicyControlClassName}>
          <RelationshipActorPolicyFields
            actorSetOptions={input.actorSetOptions}
            conditionId={input.conditionId}
            connectionId={input.connectionId}
            disabled={input.disabled}
            initialOptionId={initialOptionId}
            insertionIndex={
              input.conditionGroup.ruleIndexes[0] ?? input.conditionGroup.insertionIndex
            }
            onActorSetOptionChanging={(optionId) => {
              input.onActorSetOptionChanging(optionId);
              if (input.conditionGroup.ruleIndexes.length === 0) {
                return;
              }

              input.onPoliciesChange(
                removeActorPolicyRules({
                  conditionId: input.conditionId,
                  policies: input.policies,
                  ruleListKey: input.conditionGroup.ruleListKey,
                  ruleIndexes: input.conditionGroup.ruleIndexes,
                }),
              );
            }}
            onPoliciesChange={input.onPoliciesChange}
            onSelectionCleared={(optionId) => {
              input.onActorSetSelectionCleared(optionId, input.conditionGroup);
            }}
            policies={input.policies}
            policy={input.policy}
            resourceDefinitions={input.resourceDefinitions}
            ruleListKey={input.conditionGroup.ruleListKey}
          />
        </div>
      </div>
    );
  }

  throw new Error("Expected resource or relationship actor policy condition group.");
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
    Record<string, ActorPolicyRuleListKey>
  >({});
  const [relationshipPickerConditionIds, setRelationshipPickerConditionIds] = useState<
    Record<string, string>
  >({});
  const [relationshipPickerRuleListKeys, setRelationshipPickerRuleListKeys] = useState<
    Record<string, ActorPolicyRuleListKey>
  >({});
  const [specificActorPickerPositions, setSpecificActorPickerPositions] =
    useState<DraftActorPolicyRowPositions>({});
  const [relationshipPickerPositions, setRelationshipPickerPositions] =
    useState<DraftActorPolicyRowPositions>({});
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

  function openRelationshipPicker(inputRow: {
    conditionId: string;
    eventOption: WebhookTriggerEventOption;
    optionId: string;
    ruleListKey: ActorPolicyRuleListKey;
  }): void {
    const conditionGroups = createActorPolicyConditionGroups({
      policy: input.eventActorPolicies?.[inputRow.conditionId],
      resourceDefinitions: inputRow.eventOption.resourceDefinitions,
    });
    const specificActorPickerRuleListKey = specificActorPickerConditionIds[inputRow.conditionId];
    const hasResourceDraft =
      specificActorPickerRuleListKey !== undefined &&
      !conditionGroups.some(
        (conditionGroup) =>
          conditionGroup.kind === "resource" &&
          conditionGroup.ruleListKey === specificActorPickerRuleListKey,
      );
    setRelationshipPickerPositions((currentPositions) =>
      setDraftActorPolicyRowPosition({
        conditionId: inputRow.conditionId,
        positions: currentPositions,
        position: conditionGroups.length + (hasResourceDraft ? 1 : 0),
      }),
    );
    setRelationshipPickerConditionIds((currentOpenPickers) =>
      addRelationshipPicker({
        conditionId: inputRow.conditionId,
        openPickers: currentOpenPickers,
        optionId: inputRow.optionId,
      }),
    );
    setRelationshipPickerRuleListKeys((currentRuleListKeys) => ({
      ...currentRuleListKeys,
      [inputRow.conditionId]: inputRow.ruleListKey,
    }));
  }

  function openSpecificActorPicker(inputRow: {
    conditionId: string;
    eventOption: WebhookTriggerEventOption;
    ruleListKey: ActorPolicyRuleListKey;
  }): void {
    const conditionGroups = createActorPolicyConditionGroups({
      policy: input.eventActorPolicies?.[inputRow.conditionId],
      resourceDefinitions: inputRow.eventOption.resourceDefinitions,
    });
    const relationshipOptionId = relationshipPickerConditionIds[inputRow.conditionId];
    const relationshipRuleListKey = relationshipPickerRuleListKeys[inputRow.conditionId] ?? "anyOf";
    const connection = input.connections.find(
      (candidate) => candidate.id === inputRow.eventOption.connectionId,
    );
    const selectedActorSetOption = resolveActorSetOptions({
      actorResourceKinds: resolveActorResourceKinds({
        connection,
        eventOption: inputRow.eventOption,
      }),
      connection,
      eventOption: inputRow.eventOption,
    }).find((option) => option.id === relationshipOptionId);
    const hasRelationshipDraft =
      selectedActorSetOption !== undefined &&
      !conditionGroups.some(
        (conditionGroup) =>
          conditionGroup.kind === "relationship" &&
          conditionGroup.relationshipKind ===
            selectedActorSetOption.relationshipDefinition.relationshipKind &&
          conditionGroup.ruleListKey === relationshipRuleListKey &&
          conditionGroup.resourceKind === selectedActorSetOption.resourceKind &&
          conditionGroup.scopeKind === selectedActorSetOption.scopeKind,
      );
    setSpecificActorPickerPositions((currentPositions) =>
      setDraftActorPolicyRowPosition({
        conditionId: inputRow.conditionId,
        positions: currentPositions,
        position: conditionGroups.length + (hasRelationshipDraft ? 1 : 0),
      }),
    );
    setSpecificActorPickerConditionIds((currentOpenPickers) =>
      addSpecificActorPicker({
        conditionId: inputRow.conditionId,
        openPickers: currentOpenPickers,
        ruleListKey: inputRow.ruleListKey,
      }),
    );
  }

  return (
    <FormPageSection
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <FieldTitleWithTooltip
              className="text-base font-semibold"
              tooltip="Choose who can start this trigger. Leave it as Anyone, or add one or more actor conditions such as specific users, app bots, or members of a synced group."
              tooltipLabel="Allowed actors help"
            >
              Allowed actors
            </FieldTitleWithTooltip>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {rows.map((row) => {
          const connection = input.connections.find(
            (candidate) => candidate.id === row.eventOption.connectionId,
          );
          const actorResourceKinds = resolveActorResourceKinds({
            connection,
            eventOption: row.eventOption,
          });
          const policy = input.eventActorPolicies?.[row.conditionId];
          const rules = [...(policy?.anyOf ?? []), ...(policy?.noneOf ?? [])];
          const conditionGroups = createActorPolicyConditionGroups({
            policy,
            resourceDefinitions: row.eventOption.resourceDefinitions,
          });
          const specificActorPickerRuleListKey = specificActorPickerConditionIds[row.conditionId];
          const specificActorPickerOpen = specificActorPickerRuleListKey !== undefined;
          const actorSetOptions = resolveActorSetOptions({
            actorResourceKinds,
            connection,
            eventOption: row.eventOption,
          });
          const selectedActorSetOptionId = resolveSelectedActorSetOptionId({
            policy: undefined,
            ruleListKey: "anyOf",
            options: actorSetOptions,
          });
          const relationshipPickerOptionId = relationshipPickerConditionIds[row.conditionId];
          const relationshipPickerRuleListKey =
            relationshipPickerRuleListKeys[row.conditionId] ?? "anyOf";
          const relationshipPickerOpen = relationshipPickerOptionId !== undefined;
          const hasReadyActorSetOptions = actorSetOptions.some(
            (option) => option.summary?.syncState === "ready",
          );
          const draftResourceGroup =
            !specificActorPickerOpen ||
            conditionGroups.some(
              (conditionGroup) =>
                conditionGroup.kind === "resource" &&
                conditionGroup.ruleListKey === specificActorPickerRuleListKey,
            )
              ? null
              : {
                  id: `${specificActorPickerRuleListKey}:resource:draft:${row.conditionId}`,
                  kind: "resource" as const,
                  ruleListKey: specificActorPickerRuleListKey,
                  label:
                    specificActorPickerRuleListKey === "anyOf"
                      ? "Actor is one of"
                      : "Actor is not one of",
                  description: "",
                  ruleIndexes: [],
                  ...(specificActorPickerPositions[row.conditionId] === undefined
                    ? {}
                    : { insertionIndex: specificActorPickerPositions[row.conditionId] }),
                };
          const selectedActorSetOption = actorSetOptions.find(
            (option) => option.id === (relationshipPickerOptionId ?? selectedActorSetOptionId),
          );
          const draftRelationshipGroup =
            !relationshipPickerOpen ||
            selectedActorSetOption === undefined ||
            conditionGroups.some(
              (conditionGroup) =>
                conditionGroup.kind === "relationship" &&
                conditionGroup.relationshipKind ===
                  selectedActorSetOption.relationshipDefinition.relationshipKind &&
                conditionGroup.ruleListKey === relationshipPickerRuleListKey &&
                conditionGroup.resourceKind === selectedActorSetOption.resourceKind &&
                conditionGroup.scopeKind === selectedActorSetOption.scopeKind,
            )
              ? null
              : {
                  id: `${relationshipPickerRuleListKey}:${resolveRelationshipActorPolicyConditionGroupId(
                    {
                      relationshipKind:
                        selectedActorSetOption.relationshipDefinition.relationshipKind,
                      resourceKind: selectedActorSetOption.resourceKind,
                      scopeKind: selectedActorSetOption.scopeKind,
                    },
                  )}`,
                  kind: "relationship" as const,
                  ruleListKey: relationshipPickerRuleListKey,
                  label:
                    relationshipPickerRuleListKey === "anyOf" ? "Actor is in" : "Actor is not in",
                  description: "",
                  ruleIndexes: [],
                  ...(relationshipPickerPositions[row.conditionId] === undefined
                    ? {}
                    : { insertionIndex: relationshipPickerPositions[row.conditionId] }),
                  resourceKind: selectedActorSetOption.resourceKind,
                  relationshipKind: selectedActorSetOption.relationshipDefinition.relationshipKind,
                  scopeKind: selectedActorSetOption.scopeKind,
                };
          const groupsWithDraftResourceGroup = insertDraftActorPolicyConditionGroup({
            conditionGroups,
            draftGroup: draftResourceGroup,
            position: specificActorPickerPositions[row.conditionId],
          });
          const editableConditionGroups = insertDraftActorPolicyConditionGroup({
            conditionGroups: groupsWithDraftResourceGroup,
            draftGroup: draftRelationshipGroup,
            position: relationshipPickerPositions[row.conditionId],
          });
          return (
            <Field key={row.conditionId}>
              <FieldContent>
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <AddActorPolicyConditionButton
                      conditionId={row.conditionId}
                      connections={input.connections}
                      disabled={input.disabled}
                      eventActorPolicies={input.eventActorPolicies}
                      eventOption={row.eventOption}
                      onActorPoliciesChange={input.onActorPoliciesChange}
                      onOpenRelationshipPicker={(optionId, ruleListKey) => {
                        openRelationshipPicker({
                          conditionId: row.conditionId,
                          eventOption: row.eventOption,
                          optionId,
                          ruleListKey,
                        });
                      }}
                      onOpenSpecificActorPicker={(ruleListKey) => {
                        openSpecificActorPicker({
                          conditionId: row.conditionId,
                          eventOption: row.eventOption,
                          ruleListKey,
                        });
                      }}
                    />
                  </div>

                  {rules.length === 0 && !specificActorPickerOpen && !relationshipPickerOpen ? (
                    <div className="rounded border px-3 py-2">
                      <div className="text-sm font-medium">Anyone can trigger</div>
                      <div className="text-muted-foreground text-xs">
                        Add an actor condition to restrict who can start this trigger.
                      </div>
                    </div>
                  ) : null}

                  {editableConditionGroups.length > 0 && (
                    <div className="divide-y rounded border">
                      {editableConditionGroups.map((conditionGroup) => {
                        return (
                          <div
                            className="flex min-w-0 items-start gap-3 px-3 py-2"
                            key={conditionGroup.id}
                          >
                            <ActorPolicyConditionGroupFields
                              actorResourceKinds={actorResourceKinds}
                              actorSetOptions={actorSetOptions}
                              conditionGroup={conditionGroup}
                              conditionId={row.conditionId}
                              connectionId={row.eventOption.connectionId}
                              disabled={input.disabled}
                              resourceDefinitions={row.eventOption.resourceDefinitions}
                              onActorSetOptionChanging={(optionId) => {
                                setRelationshipPickerConditionIds((currentOpenPickers) =>
                                  addRelationshipPicker({
                                    conditionId: row.conditionId,
                                    openPickers: currentOpenPickers,
                                    optionId,
                                  }),
                                );
                                setRelationshipPickerRuleListKeys((currentRuleListKeys) => ({
                                  ...currentRuleListKeys,
                                  [row.conditionId]: conditionGroup.ruleListKey,
                                }));
                                setRelationshipPickerPositions((currentPositions) =>
                                  removeDraftActorPolicyRowPosition({
                                    conditionId: row.conditionId,
                                    positions: currentPositions,
                                  }),
                                );
                              }}
                              onActorSetSelectionCleared={(optionId, conditionGroup) => {
                                const conditionGroupIndex = conditionGroups.findIndex(
                                  (candidate) => candidate.id === conditionGroup.id,
                                );
                                setRelationshipPickerConditionIds((currentOpenPickers) =>
                                  addRelationshipPicker({
                                    conditionId: row.conditionId,
                                    openPickers: currentOpenPickers,
                                    optionId,
                                  }),
                                );
                                setRelationshipPickerRuleListKeys((currentRuleListKeys) => ({
                                  ...currentRuleListKeys,
                                  [row.conditionId]: conditionGroup.ruleListKey,
                                }));
                                if (conditionGroupIndex !== -1) {
                                  setRelationshipPickerPositions((currentPositions) =>
                                    setDraftActorPolicyRowPosition({
                                      conditionId: row.conditionId,
                                      positions: currentPositions,
                                      position: conditionGroupIndex,
                                    }),
                                  );
                                }
                              }}
                              onPoliciesChange={input.onActorPoliciesChange}
                              onRuleListKeyChanging={(ruleListKey, conditionGroup) => {
                                if (conditionGroup.kind === "resource") {
                                  setSpecificActorPickerConditionIds((currentOpenPickers) =>
                                    addSpecificActorPicker({
                                      conditionId: row.conditionId,
                                      openPickers: currentOpenPickers,
                                      ruleListKey,
                                    }),
                                  );
                                  return;
                                }

                                setRelationshipPickerRuleListKeys((currentRuleListKeys) => ({
                                  ...currentRuleListKeys,
                                  [row.conditionId]: ruleListKey,
                                }));
                              }}
                              onResourceSelectionCleared={(conditionGroup) => {
                                const conditionGroupIndex = conditionGroups.findIndex(
                                  (candidate) => candidate.id === conditionGroup.id,
                                );
                                setSpecificActorPickerConditionIds((currentOpenPickers) =>
                                  addSpecificActorPicker({
                                    conditionId: row.conditionId,
                                    openPickers: currentOpenPickers,
                                    ruleListKey: conditionGroup.ruleListKey,
                                  }),
                                );
                                if (conditionGroupIndex !== -1) {
                                  setSpecificActorPickerPositions((currentPositions) =>
                                    setDraftActorPolicyRowPosition({
                                      conditionId: row.conditionId,
                                      positions: currentPositions,
                                      position: conditionGroupIndex,
                                    }),
                                  );
                                }
                              }}
                              policies={input.eventActorPolicies}
                              policy={policy}
                            />
                            <Button
                              aria-label={`Remove actor condition ${conditionGroup.description || conditionGroup.label}`}
                              className="shrink-0"
                              disabled={input.disabled}
                              onClick={() => {
                                if (conditionGroup.ruleIndexes.length > 0) {
                                  input.onActorPoliciesChange(
                                    removeActorPolicyRules({
                                      conditionId: row.conditionId,
                                      policies: input.eventActorPolicies,
                                      ruleListKey: conditionGroup.ruleListKey,
                                      ruleIndexes: conditionGroup.ruleIndexes,
                                    }),
                                  );
                                }
                                if (conditionGroup.kind === "resource") {
                                  setSpecificActorPickerConditionIds((currentOpenPickers) =>
                                    removeSpecificActorPicker({
                                      conditionId: row.conditionId,
                                      openPickers: currentOpenPickers,
                                    }),
                                  );
                                  setSpecificActorPickerPositions((currentPositions) =>
                                    removeDraftActorPolicyRowPosition({
                                      conditionId: row.conditionId,
                                      positions: currentPositions,
                                    }),
                                  );
                                }
                                if (conditionGroup.kind === "relationship") {
                                  setRelationshipPickerConditionIds((currentOpenPickers) =>
                                    removeRelationshipPicker({
                                      conditionId: row.conditionId,
                                      openPickers: currentOpenPickers,
                                    }),
                                  );
                                  setRelationshipPickerPositions((currentPositions) =>
                                    removeDraftActorPolicyRowPosition({
                                      conditionId: row.conditionId,
                                      positions: currentPositions,
                                    }),
                                  );
                                  setRelationshipPickerRuleListKeys((currentRuleListKeys) =>
                                    Object.fromEntries(
                                      Object.entries(currentRuleListKeys).filter(
                                        ([conditionId]) => conditionId !== row.conditionId,
                                      ),
                                    ),
                                  );
                                }
                              }}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <TrashIcon aria-hidden className="size-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

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
    </FormPageSection>
  );
}
