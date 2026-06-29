import {
  type ControlPlaneDatabase,
  IntegrationConnectionResourceStatuses,
  type WebhookTriggerActorPolicy,
  type WebhookTriggerActorPolicyResourceReference,
  type WebhookTriggerActorPolicyRule,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type {
  IntegrationWebhookEventActorDefinition,
  IntegrationWebhookEventActorReferenceCondition,
  IntegrationWebhookEventActorResourceReference,
} from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import {
  ActorPolicyQueryResultStates,
  queryActorPolicyResourceRelationship,
  type ActorPolicyQueryResult,
  type ActorPolicyResourceReference,
} from "../shared/actor-policy-query-helpers.js";

export const WebhookTriggerActorPolicySkipReasons = {
  ACTOR_ATTRIBUTE_UNAVAILABLE: "actor_attribute_unavailable",
  ACTOR_MISSING: "actor_missing",
  ACTOR_POLICY_NOT_MATCHED: "actor_policy_not_matched",
  MEMBERSHIP_SCOPE_UNAVAILABLE: "membership_scope_unavailable",
} as const;

export type WebhookTriggerActorPolicySkipReason =
  (typeof WebhookTriggerActorPolicySkipReasons)[keyof typeof WebhookTriggerActorPolicySkipReasons];

export type ResolvedWebhookTriggerActorPolicyResult =
  | {
      status: "matched";
    }
  | {
      status: "skipped";
      reason: WebhookTriggerActorPolicySkipReason;
      detail: string;
    };

type ResolvedWebhookEventActor = {
  resourceKind: string;
  externalId?: string | undefined;
  handle?: string | undefined;
};

type ResolvedActorPolicyResource = {
  id: string;
  kind: string;
  externalId: string | null;
  handle: string;
};

export async function resolveWebhookTriggerActorPolicy(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  actorDefinition: IntegrationWebhookEventActorDefinition | undefined;
  actorPolicy: WebhookTriggerActorPolicy | undefined;
  payload: Record<string, unknown>;
}): Promise<ResolvedWebhookTriggerActorPolicyResult> {
  if (input.actorPolicy === undefined) {
    return { status: "matched" };
  }

  if (input.actorPolicy.anyOf === undefined && input.actorPolicy.noneOf === undefined) {
    throw new Error("Webhook trigger actor policy must include at least one rule list.");
  }

  const actor = resolveWebhookEventActor({
    actorDefinition: input.actorDefinition,
    payload: input.payload,
  });
  if (actor === undefined) {
    return {
      status: "skipped",
      reason: WebhookTriggerActorPolicySkipReasons.ACTOR_MISSING,
      detail: "actor_missing",
    };
  }

  if (input.actorPolicy.anyOf !== undefined) {
    const result = await evaluateActorPolicyRules({
      db: input.db,
      connectionId: input.connectionId,
      actor,
      rules: input.actorPolicy.anyOf,
    });
    if (result.state !== ActorPolicyQueryResultStates.MATCHED) {
      return {
        status: "skipped",
        reason: mapActorPolicyQueryResultToSkipReason(result),
        detail: result.reason ?? result.state,
      };
    }
  }

  const exclusionResult = await evaluateActorPolicyExclusionRules({
    db: input.db,
    connectionId: input.connectionId,
    actor,
    rules: input.actorPolicy.noneOf ?? [],
  });
  if (exclusionResult.state === ActorPolicyQueryResultStates.NOT_MATCHED) {
    return { status: "matched" };
  }

  return {
    status: "skipped",
    reason: mapActorPolicyQueryResultToSkipReason(exclusionResult),
    detail: exclusionResult.reason ?? exclusionResult.state,
  };
}

function resolveWebhookEventActor(input: {
  actorDefinition: IntegrationWebhookEventActorDefinition | undefined;
  payload: Record<string, unknown>;
}): ResolvedWebhookEventActor | undefined {
  if (input.actorDefinition === undefined) {
    return undefined;
  }

  for (const reference of input.actorDefinition.resourceReferences) {
    if (!isActorReferenceConditionMatched({ payload: input.payload, reference })) {
      continue;
    }

    const externalId = resolvePayloadReferenceValue({
      payload: input.payload,
      payloadPath: reference.externalIdPayloadPath,
    });
    const handle = resolvePayloadReferenceValue({
      payload: input.payload,
      payloadPath: reference.handlePayloadPath,
    });

    if (externalId !== undefined || handle !== undefined) {
      return {
        resourceKind: reference.resourceKind,
        ...(externalId === undefined ? {} : { externalId }),
        ...(handle === undefined ? {} : { handle }),
      };
    }
  }

  return undefined;
}

function isActorReferenceConditionMatched(input: {
  payload: Record<string, unknown>;
  reference: IntegrationWebhookEventActorResourceReference;
}): boolean {
  if (input.reference.when === undefined) {
    return true;
  }

  return isPayloadConditionMatched({
    condition: input.reference.when,
    payload: input.payload,
  });
}

function isPayloadConditionMatched(input: {
  condition: IntegrationWebhookEventActorReferenceCondition;
  payload: Record<string, unknown>;
}): boolean {
  const value = readPayloadPath({
    payload: input.payload,
    payloadPath: input.condition.payloadPath,
  });

  return normalizePayloadReferenceValue(value) === input.condition.equals;
}

function resolvePayloadReferenceValue(input: {
  payload: Record<string, unknown>;
  payloadPath: readonly string[] | undefined;
}): string | undefined {
  if (input.payloadPath === undefined) {
    return undefined;
  }

  return normalizePayloadReferenceValue(
    readPayloadPath({ payload: input.payload, payloadPath: input.payloadPath }),
  );
}

function readPayloadPath(input: {
  payload: Record<string, unknown>;
  payloadPath: readonly string[];
}): unknown {
  let current: unknown = input.payload;
  for (const segment of input.payloadPath) {
    if (!isUnknownRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayloadReferenceValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue.length === 0 ? undefined : trimmedValue;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return undefined;
}

async function evaluateActorPolicyRules(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  actor: ResolvedWebhookEventActor;
  rules: readonly WebhookTriggerActorPolicyRule[];
}): Promise<ActorPolicyQueryResult> {
  if (input.rules.length === 0) {
    return matched();
  }

  let unavailableResult: ActorPolicyQueryResult | undefined;
  for (const rule of input.rules) {
    const result = await evaluateActorPolicyRule({
      db: input.db,
      connectionId: input.connectionId,
      actor: input.actor,
      rule,
    });

    if (result.state === ActorPolicyQueryResultStates.MATCHED) {
      return result;
    }

    if (
      result.state === ActorPolicyQueryResultStates.DATA_UNAVAILABLE &&
      unavailableResult === undefined
    ) {
      unavailableResult = result;
    }
  }

  return unavailableResult ?? notMatched();
}

async function evaluateActorPolicyExclusionRules(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  actor: ResolvedWebhookEventActor;
  rules: readonly WebhookTriggerActorPolicyRule[];
}): Promise<ActorPolicyQueryResult> {
  if (input.rules.length === 0) {
    return notMatched();
  }

  const result = await evaluateActorPolicyRules(input);
  if (result.state === ActorPolicyQueryResultStates.MATCHED) {
    return {
      state: ActorPolicyQueryResultStates.MATCHED,
      reason: "actor_policy_excluded",
    };
  }

  return result;
}

async function evaluateActorPolicyRule(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  actor: ResolvedWebhookEventActor;
  rule: WebhookTriggerActorPolicyRule;
}): Promise<ActorPolicyQueryResult> {
  if (input.rule.kind === "resource") {
    return await evaluateSpecificActorRule({
      db: input.db,
      connectionId: input.connectionId,
      eventActor: input.actor,
      policyActor: input.rule.actor,
    });
  }

  return await queryActorPolicyResourceRelationship({
    db: input.db,
    connectionId: input.connectionId,
    relationshipKind: input.rule.relationshipKind,
    actor: createEventActorResourceReference(input.actor),
    actorSet: input.rule.actorSet,
    scope: input.rule.scope,
  });
}

async function evaluateSpecificActorRule(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  eventActor: ResolvedWebhookEventActor;
  policyActor: WebhookTriggerActorPolicyResourceReference;
}): Promise<ActorPolicyQueryResult> {
  if (input.eventActor.resourceKind !== input.policyActor.resourceKind) {
    return notMatched();
  }

  const directComparison = compareDirectReference(input.eventActor, input.policyActor);
  if (directComparison !== undefined) {
    return directComparison ? matched() : notMatched();
  }

  const eventActorResource = await resolveActorPolicyResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: createEventActorResourceReference(input.eventActor),
  });
  if (eventActorResource === undefined) {
    return dataUnavailable("actor_resource_unavailable");
  }

  const policyActorResource = await resolveActorPolicyResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: input.policyActor,
  });
  if (policyActorResource === undefined) {
    return dataUnavailable("actor_resource_unavailable");
  }

  return eventActorResource.id === policyActorResource.id ? matched() : notMatched();
}

function compareDirectReference(
  eventActor: ResolvedWebhookEventActor,
  policyActor: WebhookTriggerActorPolicyResourceReference,
): boolean | undefined {
  if (eventActor.externalId !== undefined && "externalId" in policyActor) {
    return eventActor.externalId === policyActor.externalId;
  }

  if (eventActor.handle !== undefined && "handle" in policyActor) {
    return eventActor.handle === policyActor.handle;
  }

  return undefined;
}

function createEventActorResourceReference(
  actor: ResolvedWebhookEventActor,
): ActorPolicyResourceReference {
  if (actor.externalId !== undefined) {
    return {
      resourceKind: actor.resourceKind,
      externalId: actor.externalId,
    };
  }

  if (actor.handle !== undefined) {
    return {
      resourceKind: actor.resourceKind,
      handle: actor.handle,
    };
  }

  throw new Error("Resolved webhook event actor is missing externalId and handle.");
}

async function resolveActorPolicyResource(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  reference: ActorPolicyResourceReference;
}): Promise<ResolvedActorPolicyResource | undefined> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
      kind: tables.integrationConnectionResources.kind,
      externalId: tables.integrationConnectionResources.externalId,
      handle: tables.integrationConnectionResources.handle,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.reference.resourceKind),
        createResourceReferencePredicate({
          db: input.db,
          reference: input.reference,
        }),
        eq(
          tables.integrationConnectionResources.status,
          IntegrationConnectionResourceStatuses.ACCESSIBLE,
        ),
        isNull(tables.integrationConnectionResources.removedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

function createResourceReferencePredicate(input: {
  db: ControlPlaneDatabase;
  reference: ActorPolicyResourceReference;
}) {
  const tables = getControlPlaneDatabaseSchema(input.db);
  if ("resourceId" in input.reference) {
    return eq(tables.integrationConnectionResources.id, input.reference.resourceId);
  }

  if ("externalId" in input.reference) {
    return eq(tables.integrationConnectionResources.externalId, input.reference.externalId);
  }

  return eq(tables.integrationConnectionResources.handle, input.reference.handle);
}

function matched(): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.MATCHED,
  };
}

function notMatched(): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.NOT_MATCHED,
  };
}

function dataUnavailable(reason: string): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
    reason,
  };
}

function mapActorPolicyQueryResultToSkipReason(
  result: ActorPolicyQueryResult,
): WebhookTriggerActorPolicySkipReason {
  if (
    result.state === ActorPolicyQueryResultStates.NOT_MATCHED ||
    result.reason === "actor_policy_excluded"
  ) {
    return WebhookTriggerActorPolicySkipReasons.ACTOR_POLICY_NOT_MATCHED;
  }

  if (result.reason?.startsWith("actor_attribute_") === true) {
    return WebhookTriggerActorPolicySkipReasons.ACTOR_ATTRIBUTE_UNAVAILABLE;
  }

  if (
    result.reason?.startsWith("relationship_scope_") === true ||
    result.reason?.startsWith("actor_set_") === true
  ) {
    return WebhookTriggerActorPolicySkipReasons.MEMBERSHIP_SCOPE_UNAVAILABLE;
  }

  return WebhookTriggerActorPolicySkipReasons.ACTOR_MISSING;
}
