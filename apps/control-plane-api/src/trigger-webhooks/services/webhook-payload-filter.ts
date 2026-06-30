import type {
  WebhookTriggerActorPolicy,
  WebhookTriggerActorPolicyRule,
  WebhookTriggerActorPolicyRuleList,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { TriggerWebhookActorPolicySchema } from "../schemas.js";

export type WebhookTriggerActorPolicyResourceReferenceInput =
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

export type WebhookTriggerActorPolicyRuleInput =
  | {
      kind: "resource";
      actor: WebhookTriggerActorPolicyResourceReferenceInput;
    }
  | {
      kind: "relationship";
      relationshipKind: string;
      actorSet: WebhookTriggerActorPolicyResourceReferenceInput;
      scope: WebhookTriggerActorPolicyResourceReferenceInput;
    };

export type WebhookTriggerActorPolicyInput = {
  anyOf?: WebhookTriggerActorPolicyRuleInput[] | undefined;
  noneOf?: WebhookTriggerActorPolicyRuleInput[] | undefined;
};

export type WebhookTriggerEventConditionInput = {
  eventType: string;
  actorPolicy?: WebhookTriggerActorPolicyInput | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
};

export type NormalizedWebhookTriggerEventCondition = {
  eventType: string;
  actorPolicy?: WebhookTriggerActorPolicy | undefined;
  payloadFilter?: Record<string, unknown> | undefined;
};

function normalizeConditionPayloadFilter(
  payloadFilter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (
    payloadFilter === undefined ||
    payloadFilter === null ||
    Object.keys(payloadFilter).length === 0
  ) {
    return undefined;
  }

  try {
    parseWebhookPayloadFilter(payloadFilter);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payloadFilter.";
    throw new BadRequestError(
      "VALIDATION_ERROR",
      `Invalid eventConditions payloadFilter. ${message}`,
    );
  }

  return payloadFilter;
}

function normalizeActorPolicy(
  actorPolicy: WebhookTriggerActorPolicyInput | undefined,
): WebhookTriggerActorPolicy | undefined {
  if (actorPolicy === undefined) {
    return undefined;
  }

  const parsedPolicy = TriggerWebhookActorPolicySchema.parse(actorPolicy);
  const anyOf = createActorPolicyRuleList(parsedPolicy.anyOf);
  const noneOf = createActorPolicyRuleList(parsedPolicy.noneOf);

  if (anyOf === undefined && noneOf === undefined) {
    throw new Error("Expected actor policy validation to require at least one rule list.");
  }

  if (anyOf === undefined) {
    if (noneOf === undefined) {
      throw new Error("Expected actor policy validation to require at least one rule list.");
    }

    return { noneOf };
  }

  if (noneOf === undefined) {
    return { anyOf };
  }

  return { anyOf, noneOf };
}

function createActorPolicyRuleList(
  rules: readonly WebhookTriggerActorPolicyRuleInput[] | undefined,
): WebhookTriggerActorPolicyRuleList | undefined {
  const [firstRule, ...remainingRules] = rules ?? [];
  if (firstRule === undefined) {
    return undefined;
  }

  return [normalizeActorPolicyRule(firstRule), ...remainingRules.map(normalizeActorPolicyRule)];
}

function normalizeActorPolicyRule(
  rule: WebhookTriggerActorPolicyRuleInput,
): WebhookTriggerActorPolicyRule {
  return rule;
}

export function normalizeWebhookTriggerEventConditions(
  eventConditions: readonly WebhookTriggerEventConditionInput[],
): NormalizedWebhookTriggerEventCondition[] {
  if (eventConditions.length === 0) {
    throw new BadRequestError(
      "VALIDATION_ERROR",
      "Webhook trigger must include at least one event condition.",
    );
  }

  return eventConditions.map((condition) => {
    const actorPolicy = normalizeActorPolicy(condition.actorPolicy);
    const payloadFilter = normalizeConditionPayloadFilter(condition.payloadFilter);

    return {
      eventType: condition.eventType,
      ...(actorPolicy === undefined ? {} : { actorPolicy }),
      ...(payloadFilter === undefined ? {} : { payloadFilter }),
    };
  });
}
