import type { IntegrationWebhookEventDefinition } from "../types/index.js";

export type WebhookTriggerTemplateKind = "input" | "key";

export const WebhookTriggerTemplateKinds: {
  readonly INPUT: WebhookTriggerTemplateKind;
  readonly KEY: WebhookTriggerTemplateKind;
} = {
  INPUT: "input",
  KEY: "key",
};

export type WebhookTriggerTemplateFieldName =
  | "inputTemplate"
  | "conversationKeyTemplate"
  | "idempotencyKeyTemplate";

export type WebhookTriggerTemplateValidationIssue = {
  field: WebhookTriggerTemplateFieldName;
  message: string;
};

export type WebhookTriggerTemplateValidationResult = {
  issues: readonly WebhookTriggerTemplateValidationIssue[];
};

export type WebhookTriggerTemplateInput = {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
};

const SharedAllowedReferencePaths = new Set([
  "payload",
  "webhookEvent.eventType",
  "webhookEvent.id",
  "webhookEvent.providerEventType",
  "webhookEvent.externalEventId",
  "webhookEvent.externalDeliveryId",
  "triggerRun.id",
  "triggerRun.triggerId",
  "triggerRun.triggerTargetId",
]);

const ConditionalTemplateAllowedTagNames = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
]);
const KeyTemplateAllowedTagNames = new Set(["if", "else", "endif"]);
const LiquidTokenPattern = /({{[\s\S]*?}}|{%[\s\S]*?%})/g;
const LiquidTagPattern = /{%-?\s*([A-Za-z][A-Za-z0-9_-]*)\b/g;
const SimpleKeyTemplateConditionPattern =
  /^{%-?\s*if\s+webhookEvent\.eventType\s*==\s*"([^"]+)"\s*-?%}$/;
const SimpleReferencePathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;
const ConditionReferencePathPattern = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b/g;
const QuotedStringPattern = /"[^"]*"|'[^']*'/g;
const NonReferenceConditionWords = new Set([
  "and",
  "blank",
  "contains",
  "empty",
  "false",
  "nil",
  "not",
  "null",
  "or",
  "true",
]);

type SelectedEventReferencePaths = {
  all: ReadonlySet<string>;
  common: ReadonlySet<string>;
  eventReferences: readonly ReadonlySet<string>[];
  eventTypes: readonly string[];
};

export function validateWebhookTriggerTemplates(input: {
  templates: readonly WebhookTriggerTemplateInput[];
  selectedEvents: readonly IntegrationWebhookEventDefinition[];
}): WebhookTriggerTemplateValidationResult {
  const selectedEventReferences = buildSelectedEventReferencePaths(input.selectedEvents);
  const issues = input.templates.flatMap((templateInput) =>
    validateTemplate({
      ...templateInput,
      selectedEventReferences,
    }),
  );

  return { issues };
}

export function assertWebhookTriggerTemplatesValid(input: {
  templates: readonly WebhookTriggerTemplateInput[];
  selectedEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const result = validateWebhookTriggerTemplates(input);
  if (result.issues.length > 0) {
    throw new WebhookTriggerTemplateValidationError(result.issues);
  }
}

export class WebhookTriggerTemplateValidationError extends Error {
  readonly issues: readonly WebhookTriggerTemplateValidationIssue[];

  constructor(issues: readonly WebhookTriggerTemplateValidationIssue[]) {
    super(formatWebhookTriggerTemplateValidationIssues(issues));
    this.name = "WebhookTriggerTemplateValidationError";
    this.issues = issues;
  }
}

export function formatWebhookTriggerTemplateValidationIssues(
  issues: readonly WebhookTriggerTemplateValidationIssue[],
): string {
  return issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
}

function validateTemplate(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const outputReferences: string[] = [];
  const containsTags = collectTemplateReferencesAndTagIssues({
    ...input,
    outputReferences,
    issues,
  });

  if (input.kind === WebhookTriggerTemplateKinds.KEY && containsTags) {
    issues.push(
      ...validateConditionalKeyTemplateReferences({
        field: input.field,
        template: input.template,
        selectedEventReferences: input.selectedEventReferences,
      }),
    );
    return issues;
  }

  const allowedReferences =
    input.kind === WebhookTriggerTemplateKinds.KEY
      ? input.selectedEventReferences.common
      : input.selectedEventReferences.all;

  for (const referencePath of outputReferences) {
    if (!allowedReferences.has(referencePath)) {
      issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${referencePath}}}'.`,
      });
    }
  }

  return issues;
}

function collectTemplateReferencesAndTagIssues(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
  outputReferences: string[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): boolean {
  let containsTags = false;

  LiquidTokenPattern.lastIndex = 0;
  let match: RegExpExecArray | null = LiquidTokenPattern.exec(input.template);
  while (match !== null) {
    const token = match[1];
    if (token === undefined) {
      throw new Error("Expected Liquid token pattern to capture a token.");
    }

    if (token.startsWith("{{")) {
      collectOutputReferences({
        field: input.field,
        token,
        outputReferences: input.outputReferences,
        issues: input.issues,
      });
    } else {
      containsTags = true;
      validateTemplateTag({
        field: input.field,
        token,
        kind: input.kind,
        selectedEventReferences: input.selectedEventReferences,
        issues: input.issues,
      });
    }

    match = LiquidTokenPattern.exec(input.template);
  }

  return containsTags;
}

function collectOutputReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  outputReferences: string[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const referencePath = extractOutputReferencePath(input.token);
  if (referencePath === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  input.outputReferences.push(referencePath);
}

function extractOutputReferencePath(token: string): string | null {
  const expression = token.slice(2, -2).trim();
  const [referenceExpression] = expression.split("|", 1);
  if (referenceExpression === undefined) {
    return null;
  }

  const referencePath = referenceExpression.trim();
  return SimpleReferencePathPattern.test(referencePath) ? referencePath : null;
}

function validateTemplateTag(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const tagName = extractLiquidTagName(input.token);
  if (tagName === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template tags are not supported.",
    });
    return;
  }

  const allowedTagNames =
    input.kind === WebhookTriggerTemplateKinds.KEY
      ? KeyTemplateAllowedTagNames
      : ConditionalTemplateAllowedTagNames;
  if (!allowedTagNames.has(tagName)) {
    input.issues.push({
      field: input.field,
      message:
        input.kind === WebhookTriggerTemplateKinds.KEY
          ? `Liquid tag '${tagName}' is not supported in key templates.`
          : `Liquid tag '${tagName}' is not supported in trigger user message templates.`,
    });
    return;
  }

  if (input.kind === WebhookTriggerTemplateKinds.INPUT && isConditionalTagName(tagName)) {
    validateInputTemplateConditionReferences({
      field: input.field,
      token: input.token,
      tagName,
      allowedReferences: input.selectedEventReferences.all,
      issues: input.issues,
    });
  }
}

function isConditionalTagName(tagName: string): boolean {
  return tagName === "if" || tagName === "elsif" || tagName === "unless";
}

function validateInputTemplateConditionReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  tagName: string;
  allowedReferences: ReadonlySet<string>;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const expression = extractTagExpression({
    token: input.token,
    tagName: input.tagName,
  });
  if (expression.includes("[") || expression.includes("]")) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  const referencePaths = extractConditionReferencePaths(expression);
  for (const referencePath of referencePaths) {
    if (!input.allowedReferences.has(referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${referencePath}}}'.`,
      });
    }
  }
}

function extractTagExpression(input: { token: string; tagName: string }): string {
  const expressionWithTag = input.token.replace(/^{%-?\s*/, "").replace(/\s*-?%}$/, "");
  return expressionWithTag.slice(input.tagName.length).trim();
}

function extractConditionReferencePaths(expression: string): readonly string[] {
  const expressionWithoutStrings = expression.replace(QuotedStringPattern, " ");
  const referencePaths: string[] = [];

  ConditionReferencePathPattern.lastIndex = 0;
  let match: RegExpExecArray | null = ConditionReferencePathPattern.exec(expressionWithoutStrings);
  while (match !== null) {
    const referencePath = match[0];
    if (!NonReferenceConditionWords.has(referencePath)) {
      referencePaths.push(referencePath);
    }

    match = ConditionReferencePathPattern.exec(expressionWithoutStrings);
  }

  return referencePaths;
}

function validateConditionalKeyTemplateReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const allEventIndexes = input.selectedEventReferences.eventReferences.map(
    (_referenceSet, index) => index,
  );
  const stack: {
    parentReachableEventIndexes: readonly number[];
    ifBranchReachableEventIndexes: readonly number[];
  }[] = [];
  let reachableEventIndexes: readonly number[] = allEventIndexes;

  LiquidTokenPattern.lastIndex = 0;
  let match: RegExpExecArray | null = LiquidTokenPattern.exec(input.template);
  while (match !== null) {
    const token = match[1];
    if (token === undefined) {
      throw new Error("Expected Liquid token pattern to capture a token.");
    }

    if (token.startsWith("{{")) {
      const referencePath = extractOutputReferencePath(token);
      if (referencePath === null) {
        issues.push({
          field: input.field,
          message: "Dynamic template references are not supported.",
        });
      } else {
        validateReferencePathForReachableEvents({
          field: input.field,
          referencePath,
          reachableEventIndexes,
          selectedEventReferences: input.selectedEventReferences,
          issues,
        });
      }
    } else {
      const tagName = extractLiquidTagName(token);
      if (tagName === "if") {
        const conditionEventType = extractSimpleKeyTemplateConditionEventType(
          input.field,
          token,
          issues,
        );
        const ifBranchReachableEventIndexes =
          conditionEventType === null
            ? []
            : filterReachableEventsByEventType({
                selectedEventReferences: input.selectedEventReferences,
                reachableEventIndexes,
                eventType: conditionEventType,
              });
        stack.push({
          parentReachableEventIndexes: reachableEventIndexes,
          ifBranchReachableEventIndexes,
        });
        reachableEventIndexes = ifBranchReachableEventIndexes;
      } else if (tagName === "else") {
        const currentFrame = stack.at(-1);
        if (currentFrame !== undefined) {
          reachableEventIndexes = currentFrame.parentReachableEventIndexes.filter(
            (eventIndex) => !currentFrame.ifBranchReachableEventIndexes.includes(eventIndex),
          );
        }
      } else if (tagName === "endif") {
        const currentFrame = stack.pop();
        if (currentFrame !== undefined) {
          reachableEventIndexes = currentFrame.parentReachableEventIndexes;
        }
      }
    }

    match = LiquidTokenPattern.exec(input.template);
  }

  return issues;
}

function extractLiquidTagName(token: string): string | null {
  LiquidTagPattern.lastIndex = 0;
  const match = LiquidTagPattern.exec(token);
  return match?.[1] ?? null;
}

function extractSimpleKeyTemplateConditionEventType(
  field: WebhookTriggerTemplateFieldName,
  token: string,
  issues: WebhookTriggerTemplateValidationIssue[],
): string | null {
  const match = SimpleKeyTemplateConditionPattern.exec(token);
  if (match === null) {
    issues.push({
      field,
      message:
        'Only webhookEvent.eventType equality conditions are supported in key templates, for example {% if webhookEvent.eventType == "provider.event" %}.',
    });
    return null;
  }

  const eventType = match[1];
  if (eventType === undefined) {
    throw new Error("Expected key template condition pattern to capture an event type.");
  }

  return eventType;
}

function filterReachableEventsByEventType(input: {
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  eventType: string;
}): readonly number[] {
  return input.reachableEventIndexes.filter((eventIndex) => {
    const eventType = input.selectedEventReferences.eventTypes[eventIndex];
    if (eventType === undefined) {
      throw new Error(`Missing selected event type for index ${eventIndex}.`);
    }

    return eventType === input.eventType;
  });
}

function validateReferencePathForReachableEvents(input: {
  field: WebhookTriggerTemplateFieldName;
  referencePath: string;
  reachableEventIndexes: readonly number[];
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  if (input.selectedEventReferences.eventReferences.length === 0) {
    if (!input.selectedEventReferences.common.has(input.referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
      });
    }
    return;
  }

  for (const eventIndex of input.reachableEventIndexes) {
    const eventReferences = input.selectedEventReferences.eventReferences[eventIndex];
    if (eventReferences === undefined) {
      throw new Error(`Missing selected event reference set for index ${eventIndex}.`);
    }

    if (!eventReferences.has(input.referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
      });
      return;
    }
  }
}

function buildSelectedEventReferencePaths(
  selectedEvents: readonly IntegrationWebhookEventDefinition[],
): SelectedEventReferencePaths {
  const perEventReferences = selectedEvents.map(buildEventReferencePaths);

  return {
    all:
      perEventReferences.length === 0
        ? new Set(SharedAllowedReferencePaths)
        : unionReferencePaths(perEventReferences),
    common:
      perEventReferences.length === 0
        ? new Set(SharedAllowedReferencePaths)
        : intersectReferencePaths(perEventReferences),
    eventReferences: perEventReferences,
    eventTypes: selectedEvents.map((eventDefinition) => eventDefinition.eventType),
  };
}

function buildEventReferencePaths(
  eventDefinition: IntegrationWebhookEventDefinition,
): ReadonlySet<string> {
  const references = new Set(SharedAllowedReferencePaths);

  for (const payloadReference of eventDefinition.payloadReferences ?? []) {
    addPayloadReferencePath(references, payloadReference.path);
  }

  return references;
}

function unionReferencePaths(referenceSets: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const union = new Set<string>();
  for (const referenceSet of referenceSets) {
    for (const reference of referenceSet) {
      union.add(reference);
    }
  }

  return union;
}

function intersectReferencePaths(
  referenceSets: readonly ReadonlySet<string>[],
): ReadonlySet<string> {
  const [firstReferenceSet, ...remainingReferenceSets] = referenceSets;
  if (firstReferenceSet === undefined) {
    return new Set();
  }

  const intersection = new Set(firstReferenceSet);
  for (const reference of firstReferenceSet) {
    if (!remainingReferenceSets.every((referenceSet) => referenceSet.has(reference))) {
      intersection.delete(reference);
    }
  }

  return intersection;
}

function addPayloadReferencePath(
  allowedReferences: Set<string>,
  payloadReferencePath: readonly string[],
): void {
  allowedReferences.add("payload");

  for (let index = 1; index <= payloadReferencePath.length; index += 1) {
    allowedReferences.add(["payload", ...payloadReferencePath.slice(0, index)].join("."));
  }
}
