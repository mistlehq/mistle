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
      kind: "attribute";
      attributeKey: string;
      attributeValue: string;
      valueType: "boolean" | "number" | "string";
    }
  | {
      kind: "relationship";
      relationshipKind: string;
      actorSet: WebhookTriggerActorPolicyResourceReferenceInput;
      scope: WebhookTriggerActorPolicyResourceReferenceInput;
    };

export type WebhookTriggerActorPolicyInput = {
  anyOf: WebhookTriggerActorPolicyRuleInput[];
};

export type WebhookTriggerEventConditionInput = {
  eventType: string;
  actorPolicy?: WebhookTriggerActorPolicyInput | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
};

export type NormalizedWebhookTriggerEventCondition = {
  eventType: string;
  actorPolicy?: WebhookTriggerActorPolicyInput | undefined;
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
): WebhookTriggerActorPolicyInput | undefined {
  if (actorPolicy === undefined) {
    return undefined;
  }

  return TriggerWebhookActorPolicySchema.parse(actorPolicy);
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
